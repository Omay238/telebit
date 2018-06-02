(function () {
'use strict';

var WebSocket = require('ws');
var PromiseA = require('bluebird');
var sni = require('sni');
var Packer = require('proxy-packer');

function timeoutPromise(duration) {
  return new PromiseA(function (resolve) {
    setTimeout(resolve, duration);
  });
}

function run(state) {
  // jshint latedef:false
  var activityTimeout = state.activityTimeout || (2*60 - 5)*1000;
  var pongTimeout = state.pongTimeout || 10*1000;
  // Allow the tunnel client to be created with no token. This will prevent the connection from
  // being established initialy and allows the caller to use `.append` for the first token so
  // they can get a promise that will provide feedback about invalid tokens.
  var tokens = [];
  if (state.token) {
    tokens.push(state.token);
  }

  var wstunneler;
  var authenticated = false;

  var localclients = {};
  var pausedClients = [];
  var clientHandlers = {
    add: function (conn, cid, tun) {
      localclients[cid] = conn;
      console.info("[connect] new client '" + cid + "' for '" + tun.name + ":" + tun.serviceport + "' "
        + "(" + clientHandlers.count() + " clients)");

      conn.tunnelCid = cid;
      conn.tunnelRead = tun.data.byteLength;
      conn.tunnelWritten    = 0;

      conn.on('data', function onLocalData(chunk) {
        if (conn.tunnelClosing) {
          console.warn("[onLocalData] received data for '"+cid+"' over socket after connection was ended");
          return;
        }
        // This value is bytes written to the tunnel (ie read from the local connection)
        conn.tunnelWritten += chunk.byteLength;

        // If we have a lot of buffered data waiting to be sent over the websocket we want to slow
        // down the data we are getting to send over. We also want to pause all active connections
        // if any connections are paused to make things more fair so one connection doesn't get
        // stuff waiting for all other connections to finish because it tried writing near the border.
        var bufSize = wsHandlers.sendMessage(Packer.pack(tun, chunk));
        if (pausedClients.length || bufSize > 1024*1024) {
          // console.log('[onLocalData] paused connection', cid, 'to allow websocket to catch up');
          conn.pause();
          pausedClients.push(conn);
        }
      });

      var sentEnd = false;
      conn.on('end', function onLocalEnd() {
        console.info("[onLocalEnd] connection '" + cid + "' ended, will probably close soon");
        conn.tunnelClosing = true;
        if (!sentEnd) {
          wsHandlers.sendMessage(Packer.pack(tun, null, 'end'));
          sentEnd = true;
        }
      });
      conn.on('error', function onLocalError(err) {
        console.info("[onLocalError] connection '" + cid + "' errored:", err);
        if (!sentEnd) {
          wsHandlers.sendMessage(Packer.pack(tun, {message: err.message, code: err.code}, 'error'));
          sentEnd = true;
        }
      });
      conn.on('close', function onLocalClose(hadErr) {
        delete localclients[cid];
        console.log('[onLocalClose] closed "' + cid + '" read:'+conn.tunnelRead+', wrote:'+conn.tunnelWritten+' (' + clientHandlers.count() + ' clients)');
        if (!sentEnd) {
          wsHandlers.sendMessage(Packer.pack(tun, null, hadErr && 'error' || 'end'));
          sentEnd = true;
        }
      });
    }

  , write: function (cid, opts) {
      var conn = localclients[cid];
      if (!conn) {
        return false;
      }
      //console.log("[=>] received data from '" + cid + "' =>", opts.data.byteLength);

      if (conn.tunnelClosing) {
        console.warn("[onmessage] received data for '"+cid+"' over socket after connection was ended");
        return true;
      }

      conn.write(opts.data);
      // It might seem weird to increase the "read" value in a function named `write`, but this
      // is bytes read from the tunnel and written to the local connection.
      conn.tunnelRead += opts.data.byteLength;

      if (!conn.remotePaused && conn.bufferSize > 1024*1024) {
        wsHandlers.sendMessage(Packer.pack(opts, conn.tunnelRead, 'pause'));
        conn.remotePaused = true;

        conn.once('drain', function () {
          wsHandlers.sendMessage(Packer.pack(opts, conn.tunnelRead, 'resume'));
          conn.remotePaused = false;
        });
      }
      return true;
    }

  , closeSingle: function (cid) {
      if (!localclients[cid]) {
        return;
      }

      console.log('[closeSingle]', cid);
      PromiseA.resolve().then(function () {
        var conn = localclients[cid];
        conn.tunnelClosing = true;
        conn.end();

        // If no data is buffered for writing then we don't need to wait for it to drain.
        if (!conn.bufferSize) {
          return timeoutPromise(500);
        }
        // Otherwise we want the connection to be able to finish, but we also want to impose
        // a time limit for it to drain, since it shouldn't have more than 1MB buffered.
        return new PromiseA(function (resolve) {
          var timeoutId = setTimeout(resolve, 60*1000);
          conn.once('drain', function () {
            clearTimeout(timeoutId);
            setTimeout(resolve, 500);
          });
        });
      }).then(function () {
        if (localclients[cid]) {
          console.warn('[closeSingle]', cid, 'connection still present after calling `end`');
          localclients[cid].destroy();
          return timeoutPromise(500);
        }
      }).then(function () {
        if (localclients[cid]) {
          console.error('[closeSingle]', cid, 'connection still present after calling `destroy`');
          delete localclients[cid];
        }
      }).catch(function (err) {
        console.error('[closeSingle] failed to close connection', cid, err.toString());
        delete localclients[cid];
      });
    }
  , closeAll: function () {
      console.log('[closeAll]');
      Object.keys(localclients).forEach(function (cid) {
        clientHandlers.closeSingle(cid);
      });
    }

  , count: function () {
      return Object.keys(localclients).length;
    }
  };

  var pendingCommands = {};
  function sendCommand(name) {
    var id = Math.ceil(1e9 * Math.random());
    var cmd = [id, name].concat(Array.prototype.slice.call(arguments, 1));

    wsHandlers.sendMessage(Packer.pack(null, cmd, 'control'));
    setTimeout(function () {
      if (pendingCommands[id]) {
        console.warn('command', id, 'timed out');
        pendingCommands[id]({
          message: 'response not received in time'
        , code: 'E_TIMEOUT'
        });
      }
    }, pongTimeout);

    return new PromiseA(function (resolve, reject) {
      pendingCommands[id] = function (err, result) {
        delete pendingCommands[id];
        if (err) {
          reject(err);
        } else {
          resolve(result);
        }
      };
    });
  }

  function sendAllTokens() {
    tokens.forEach(function (jwtoken) {
      sendCommand('add_token', jwtoken)
        .catch(function (err) {
          console.error('failed re-adding token', jwtoken, 'after reconnect', err);
          // Not sure if we should do something like remove the token here. It worked
          // once or it shouldn't have stayed in the list, so it's less certain why
          // it would have failed here.
        });
    });
  }

  function displayGrants(grants) {
    // TODO sortingHat.print();
    console.log("");
    console.log("Connect to your device by any of the following means:");
    console.log("");
    grants.forEach(function (arr) {
      if ('ssh+https' === arr[0]) {
        console.log("SSH+HTTPS");
      } else if ('ssh' === arr[0]) {
        console.log("SSH");
      } else if ('tcp' === arr[0]) {
        console.log("TCP");
      } else if ('https' === arr[0]) {
        console.log("HTTPS");
      }
      console.log('\t' + arr[0] + '://' + arr[1] + (arr[2] ? (':' + arr[2]) : ''));
      if ('ssh+https' === arr[0]) {
        console.log("\tex: ssh -o ProxyCommand='openssl s_client -connect %h:%p -quiet' " + arr[1] + " -p 443\n");
      } else if ('ssh' === arr[0]) {
        console.log("\tex: ssh " + arr[1] + " -p " + arr[2] + "\n");
      } else if ('tcp' === arr[0]) {
        console.log("\tex: netcat " + arr[1] + " " + arr[2] + "\n");
      } else if ('https' === arr[0]) {
        console.log("\tex: curl https://" + arr[1] + "\n");
      }
    });
  }

  var connCallback;

  var packerHandlers = {
    oncontrol: function (opts) {
      var cmd, err;
      try {
        cmd = JSON.parse(opts.data.toString());
      } catch (err) {}
      if (!Array.isArray(cmd) || typeof cmd[0] !== 'number') {
        console.warn('received bad command "' + opts.data.toString() + '"');
        return;
      }

      if (cmd[0] < 0) {
        var cb = pendingCommands[-cmd[0]];
        if (!cb) {
          console.warn('received response for unknown request:', cmd);
        } else {
          cb.apply(null, cmd.slice(1));
        }
        return;
      }

      if (cmd[0] === 0) {
        console.warn('received dis-associated error from server', cmd[1]);
        if (connCallback) {
          connCallback(cmd[1]);
        }
        return;
      }

      if (cmd[1] === 'hello') {
        // We only get the 'hello' event after the token has been validated
        authenticated = true;
        sendAllTokens();
        if (connCallback) {
          connCallback();
        }
        // TODO: handle the versions and commands provided by 'hello' - isn't super important
        // yet since there is only one version and set of commands.
        err = null;
      }
      else {
        err = { message: 'unknown command "'+cmd[1]+'"', code: 'E_UNKNOWN_COMMAND' };
      }

      if (cmd[1] === 'grant') {
        displayGrants(cmd[2]);
        return;
      }

      wsHandlers.sendMessage(Packer.pack(null, [-cmd[0], err], 'control'));
    }

  , onmessage: function (tun) {
      var cid = tun._id = Packer.addrToId(tun);
      var str;
      var m;

      if ('http' === tun.service) {
        str = tun.data.toString();
        m = str.match(/(?:^|[\r\n])Host: ([^\r\n]+)[\r\n]*/im);
        tun._name = tun._hostname = (m && m[1].toLowerCase() || '').split(':')[0];
      }
      else if ('https' === tun.service || 'tls' === tun.service) {
        tun._name = tun._servername = sni(tun.data);
      } else {
        tun._name = '';
      }

      if (clientHandlers.write(cid, tun)) { return; }

      wstunneler.pause();
      require(state.sortingHat).assign(state, tun, function (err, conn) {
        if (err) {
          err.message = err.message.replace(/:tun_id/, tun._id);
          packerHandlers._onConnectError(cid, tun, err);
          return;
        }
        clientHandlers.add(conn, cid, tun);
        if (tun.data) { conn.write(tun.data); }
        wstunneler.resume();
      });
    }

  , onpause: function (opts) {
      var cid = Packer.addrToId(opts);
      if (localclients[cid]) {
        console.log("[TunnelPause] pausing '"+cid+"', remote received", opts.data.toString(), 'of', localclients[cid].tunnelWritten, 'sent');
        localclients[cid].manualPause = true;
        localclients[cid].pause();
      } else {
        console.log('[TunnelPause] remote tried pausing finished connection', cid);
        // Often we have enough latency that we've finished sending before we're told to pause, so
        // don't worry about sending back errors, since we won't be sending data over anyway.
        // wsHandlers.sendMessage(Packer.pack(opts, {message: 'no matching connection', code: 'E_NO_CONN'}, 'error'));
      }
    }
  , onresume: function (opts) {
      var cid = Packer.addrToId(opts);
      if (localclients[cid]) {
        console.log("[TunnelResume] resuming '"+cid+"', remote received", opts.data.toString(), 'of', localclients[cid].tunnelWritten, 'sent');
        localclients[cid].manualPause = false;
        localclients[cid].resume();
      } else {
        console.log('[TunnelResume] remote tried resuming finished connection', cid);
        // wsHandlers.sendMessage(Packer.pack(opts, {message: 'no matching connection', code: 'E_NO_CONN'}, 'error'));
      }
    }

  , onend: function (opts) {
      var cid = Packer.addrToId(opts);
      //console.log("[end] '" + cid + "'");
      clientHandlers.closeSingle(cid);
    }
  , onerror: function (opts) {
      var cid = Packer.addrToId(opts);
      //console.log("[error] '" + cid + "'", opts.code || '', opts.message);
      clientHandlers.closeSingle(cid);
    }

  , _onConnectError: function (cid, opts, err) {
      console.info("[_onConnectError] opening '" + cid + "' failed because " + err.message);
      wsHandlers.sendMessage(Packer.pack(opts, null, 'error'));
    }
  };

  var lastActivity;
  var timeoutId;
  var wsHandlers = {
    refreshTimeout: function () {
      lastActivity = Date.now();
    }
  , checkTimeout: function () {
      if (!wstunneler) {
        console.warn('checkTimeout called when websocket already closed');
        return;
      }
      // Determine how long the connection has been "silent", ie no activity.
      var silent = Date.now() - lastActivity;

      // If we have had activity within the last activityTimeout then all we need to do is
      // call this function again at the soonest time when the connection could be timed out.
      if (silent < activityTimeout) {
        timeoutId = setTimeout(wsHandlers.checkTimeout, activityTimeout-silent);
      }

      // Otherwise we check to see if the pong has also timed out, and if not we send a ping
      // and call this function again when the pong will have timed out.
      else if (silent < activityTimeout + pongTimeout) {
        console.log('pinging tunnel server');
        try {
          wstunneler.ping();
        } catch (err) {
          console.warn('failed to ping tunnel server', err);
        }
        timeoutId = setTimeout(wsHandlers.checkTimeout, pongTimeout);
      }

      // Last case means the ping we sent before didn't get a response soon enough, so we
      // need to close the websocket connection.
      else {
        console.log('connection timed out');
        wstunneler.close(1000, 'connection timeout');
      }
    }

  , onOpen: function () {
      console.info("[open] connected to '" + state.relay + "'");
      wsHandlers.refreshTimeout();
      timeoutId = setTimeout(wsHandlers.checkTimeout, activityTimeout);

      wstunneler._socket.on('drain', function () {
        // the websocket library has it's own buffer apart from node's socket buffer, but that one
        // is much more difficult to watch, so we watch for the lower level buffer to drain and
        // then check to see if the upper level buffer is still too full to write to. Note that
        // the websocket library buffer has something to do with compression, so I'm not requiring
        // that to be 0 before we start up again.
        if (wstunneler.bufferedAmount > 128*1024) {
          return;
        }

        pausedClients.forEach(function (conn) {
          if (!conn.manualPause) {
            // console.log('resuming connection', conn.tunnelCid, 'now the websocket has caught up');
            conn.resume();
          }
        });

        pausedClients.length = 0;
      });
    }

  , onClose: function () {
      console.log('ON CLOSE');
      clearTimeout(timeoutId);
      wstunneler = null;
      clientHandlers.closeAll();

      var error = new Error('websocket connection closed before response');
      error.code = 'E_CONN_CLOSED';
      Object.keys(pendingCommands).forEach(function (id) {
        pendingCommands[id](error);
      });
      if (connCallback) {
        connCallback(error);
      }

      if (!authenticated) {
        console.info('[close] failed on first attempt... check authentication.');
        timeoutId = null;
      }
      else if (tokens.length) {
        console.info('[retry] disconnected and waiting...');
        timeoutId = setTimeout(connect, 5000);
      }
    }

  , onError: function (err) {
      console.error("[tunnel error] " + err.message);
      console.error(err);
      if (connCallback) {
        connCallback(err);
      }
    }

  , sendMessage: function (msg) {
      if (wstunneler) {
        try {
          wstunneler.send(msg, {binary: true});
          return wstunneler.bufferedAmount;
        } catch (err) {
          // There is a chance that this occurred after the websocket was told to close
          // and before it finished, in which case we don't need to log the error.
          if (wstunneler.readyState !== wstunneler.CLOSING) {
            console.warn('[sendMessage] error sending websocket message', err);
          }
        }
      }
    }
  };

  function connect() {
    if (!tokens.length) {
      console.warn("[Non-fatal Error] No tokens. Nothing to do.");
      return;
    }
    if (wstunneler) {
      console.warn('attempted to connect with connection already active');
      return;
    }
    timeoutId = null;
    var machine = Packer.create(packerHandlers);

    console.info("[connect] '" + state.relay + "'");
    var tunnelUrl = state.relay.replace(/\/$/, '') + '/?access_token=' + tokens[0];
    wstunneler = new WebSocket(tunnelUrl, { rejectUnauthorized: !state.insecure });
    wstunneler.on('open', wsHandlers.onOpen);
    wstunneler.on('close', wsHandlers.onClose);
    wstunneler.on('error', wsHandlers.onError);

    // Our library will automatically handle sending the pong respose to ping requests.
    wstunneler.on('ping', wsHandlers.refreshTimeout);
    wstunneler.on('pong', wsHandlers.refreshTimeout);
    wstunneler.on('message', function (data, flags) {
      wsHandlers.refreshTimeout();
      if (data.error || '{' === data[0]) {
        console.log(data);
        return;
      }
      machine.fns.addChunk(data, flags);
    });
  }
  connect();

  var connPromise;
  return {
    end: function() {
      tokens.length = 0;
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }

      if (wstunneler) {
        try {
          wstunneler.close();
        } catch(e) {
          console.error("[error] wstunneler.close()");
          console.error(e);
        }
      }
    }
  , append: function (token) {
      if (tokens.indexOf(token) >= 0) {
        return PromiseA.resolve();
      }
      tokens.push(token);
      var prom;
      if (tokens.length === 1 && !wstunneler) {
        // We just added the only token in the list, and the websocket connection isn't up
        // so we need to restart the connection.
        if (timeoutId) {
          // Handle the case were the last token was removed and this token added between
          // reconnect attempts to make sure we don't try openning multiple connections.
          clearTimeout(timeoutId);
          timeoutId = null;
        }

        // We want this case to behave as much like the other case as we can, but we don't have
        // the same kind of reponses when we open brand new connections, so we have to rely on
        // the 'hello' and the 'un-associated' error commands to determine if the token is good.
        prom = connPromise = new PromiseA(function (resolve, reject) {
          connCallback = function (err) {
            connCallback = null;
            connPromise = null;
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          };
        });
        connect();
      }
      else if (connPromise) {
        prom = connPromise.then(function () {
          return sendCommand('add_token', token);
        });
      }
      else {
        prom = sendCommand('add_token', token);
      }

      prom.catch(function (err) {
        console.error('adding token', token, 'failed:', err);
        // Most probably an invalid token of some kind, so we don't really want to keep it.
        tokens.splice(tokens.indexOf(token), 1);
      });

      return prom;
    }
  , clear: function (token) {
      if (typeof token === 'undefined') {
        token = '*';
      }

      if (token === '*') {
        tokens.length = 0;
      } else {
        var index = tokens.indexOf(token);
        if (index < 0) {
          return PromiseA.resolve();
        }
        tokens.splice(index);
      }

      var prom = sendCommand('delete_token', token);
      prom.catch(function (err) {
        console.error('clearing token', token, 'failed:', err);
      });

      return prom;
    }
  };
}

module.exports.connect = run;
module.exports.createConnection = run;

}());