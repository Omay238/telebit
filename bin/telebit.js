#!/usr/bin/env node
(function () {
'use strict';

var pkg = require('../package.json');
console.log(pkg.name, pkg.version);

var url = require('url');
var path = require('path');
var remote = require('../');
var state = {};

var argv = process.argv.slice(2);

var confIndex = argv.indexOf('--config');
var confpath;
if (-1 === confIndex) {
  confIndex = argv.indexOf('-c');
}
confpath = argv[confIndex + 1];

function help() {
  console.info('');
  console.info('Telebit Remote v' + pkg.version);
  console.info('');
  console.info('Usage:');
  console.info('');
  console.info('\ttelebit --config <path>');
  console.info('');
  console.info('Example:');
  console.info('');
  console.info('\ttelebit --config /etc/telebit/telebit.yml');
  console.info('');
  console.info('Config:');
  console.info('');
  console.info('\tSee https://git.coolaj86.com/coolaj86/telebit.js');
  console.info('');
  console.info('');
  process.exit(0);
}

if (-1 === confIndex) {
  confpath = path.join(require('os').homedir(), '.config/telebit/telebit.yml');
  console.info('Using default --config "' + confpath + '"');
}

if (-1 !== argv.indexOf('-h') || -1 !== argv.indexOf('--help')) {
  help();
}
if (!confpath || /^--/.test(confpath)) {
  help();
}
var tokenfile = 'access_token.txt';
var tokenpath = path.join(path.dirname(confpath), tokenfile);
var token;
try {
  token = require('fs').readFileSync(tokenpath, 'ascii').trim();
} catch(e) {
  // ignore
}
require('fs').readFile(confpath, 'utf8', function (err, text) {
  var config;

  var recase = require('recase').create({});
  var camelCopy = recase.camelCopy.bind(recase);

  if (err) {
    console.error("\nCouldn't load config:\n\n\t" + err.message + "\n");
    process.exit(1);
    return;
  }

  try {
    config = JSON.parse(text);
  } catch(e1) {
    try {
      config = require('js-yaml').safeLoad(text);
    } catch(e2) {
      console.error(e1.message);
      console.error(e2.message);
      process.exit(1);
      return;
    }
  }

  state._confpath = confpath;
  state.config = camelCopy(config);
  if (state.config.token && token) {
    console.warn();
    console.warn("Found two tokens:");
    console.warn();
    console.warn("\t1. " + tokenpath);
    console.warn("\n2. " + confpath);
    console.warn();
    console.warn("Choosing the first.");
    console.warn();
  }
  state.config.token = token;
  rawTunnel();
});

function connectTunnel() {
  state.net = {
    createConnection: function (info, cb) {
      // data is the hello packet / first chunk
      // info = { data, servername, port, host, remoteFamily, remoteAddress, remotePort }
      var net = require('net');
      // socket = { write, push, end, events: [ 'readable', 'data', 'error', 'end' ] };
      var socket = net.createConnection({ port: info.port, host: info.host }, cb);
      return socket;
    }
  };

  state.greenlock = state.config.greenlock || {};
  if (!state.config.sortingHat) {
    state.config.sortingHat = path.resolve(__dirname, '..', 'lib/sorting-hat.js');
  }
  // TODO sortingHat.print();

  // TODO Check undefined vs false for greenlock config
  var tun = remote.connect({
    relay: state.config.relay
  , config: state.config
  , _confpath: confpath
  , sortingHat: state.config.sortingHat
  , net: state.net
  , insecure: state.config.relay_ignore_invalid_certificates
  , token: state.token
  , handlers: {
      grant: function (grants) {
        console.info("");
        console.info("Connect to your device by any of the following means:");
        console.info("");
        grants.forEach(function (arr) {
          if ('ssh+https' === arr[0]) {
            console.info("SSH+HTTPS");
          } else if ('ssh' === arr[0]) {
            console.info("SSH");
          } else if ('tcp' === arr[0]) {
            console.info("TCP");
          } else if ('https' === arr[0]) {
            console.info("HTTPS");
          }
          console.log('\t' + arr[0] + '://' + arr[1] + (arr[2] ? (':' + arr[2]) : ''));
          if ('ssh+https' === arr[0]) {
            console.info("\tex: ssh -o ProxyCommand='openssl s_client -connect %h:%p -quiet' " + arr[1] + " -p 443\n");
          } else if ('ssh' === arr[0]) {
            console.info("\tex: ssh " + arr[1] + " -p " + arr[2] + "\n");
          } else if ('tcp' === arr[0]) {
            console.info("\tex: netcat " + arr[1] + " " + arr[2] + "\n");
          } else if ('https' === arr[0]) {
            console.info("\tex: curl https://" + arr[1] + "\n");
          }
        });
      }
    , access_token: function (opts) {
        console.info("Updating '" + tokenpath + "' with new token:");
        try {
          require('fs').writeFileSync(tokenpath, opts.jwt);
        } catch (e) {
          console.error("Token not saved:");
          console.error(e);
        }
      }
    }
  , greenlockConfig: {
      version: state.greenlock.version || 'draft-11'
    , server: state.greenlock.server || 'https://acme-v02.api.letsencrypt.org/directory'
    , communityMember: state.greenlock.communityMember || state.config.communityMember
    , telemetry: state.greenlock.telemetry || state.config.telemetry
    , configDir: state.greenlock.configDir || path.resolve(__dirname, '..', '/etc/acme/')
    // TODO, store: require(state.greenlock.store.name || 'le-store-certbot').create(state.greenlock.store.options || {})
    , approveDomains: function (opts, certs, cb) {
        // Certs being renewed are listed in certs.altnames
        if (certs) {
          opts.domains = certs.altnames;
          cb(null, { options: opts, certs: certs });
          return;
        }

        // by virtue of the fact that it's being tunneled through a
        // trusted source that is already checking, we're good
        //if (-1 !== state.config.servernames.indexOf(opts.domains[0])) {
          opts.email = state.greenlock.email || state.config.email;
          opts.agreeTos = state.greenlock.agree || state.config.agreeTos;
          cb(null, { options: opts, certs: certs });
          return;
        //}

        //cb(new Error("servername not found in allowed list"));
      }
    }
  });

  function sigHandler() {
    console.info('Received kill signal. Attempting to exit cleanly...');

    // We want to handle cleanup properly unless something is broken in our cleanup process
    // that prevents us from exitting, in which case we want the user to be able to send
    // the signal again and exit the way it normally would.
    process.removeListener('SIGINT', sigHandler);
    tun.end();
  }
  process.on('SIGINT', sigHandler);
}

function rawTunnel() {
  if (!state.config.relay) {
    throw new Error("'" + state._confpath + "' is missing 'relay'");
  }

  /*
  if (!(state.config.secret || state.config.token)) {
    console.error("You must use --secret or --token with --relay");
    process.exit(1);
    return;
  }
  */

  var location = url.parse(state.config.relay);
  if (!location.protocol || /\./.test(location.protocol)) {
    state.config.relay = 'wss://' + state.config.relay;
    location = url.parse(state.config.relay);
  }
  var aud = location.hostname + (location.port ? ':' + location.port : '');
  state.config.relay = location.protocol + '//' + aud;

  if (!state.config.token && state.config.secret) {
    var jwt = require('jsonwebtoken');
    var tokenData = {
      domains: Object.keys(state.config.servernames || {}).filter(function (name) { return /\./.test(name); })
    , aud: aud
    , iss: Math.round(Date.now() / 1000)
    };

    state.token = jwt.sign(tokenData, state.config.secret);
  }
  state.token = state.token || state.config.token;

  // TODO sign token with own private key, including public key and thumbprint
  //      (much like ACME JOSE account)

  connectTunnel();
}

/*
var domainsMap = {};
var services = {};

function collectDomains(val, memo) {
  var vals = val.split(/,/g);

  function parseProxy(location) {
    // john.example.com
    // http:john.example.com:3000
    // http://john.example.com:3000
    var parts = location.split(':');
    if (1 === parts.length) {
      // john.example.com -> :john.example.com:0
      parts[1] = parts[0];

      parts[0] = '';
      parts[2] = 0;
    }
    else if (2 === parts.length) {
      throw new Error("invalid arguments for --domains, should use the format <domainname> or <scheme>:<domainname>:<local-port>");
    }
    if (!parts[1]) {
      throw new Error("invalid arguments for --domains, should use the format <domainname> or <scheme>:<domainname>:<local-port>");
    }

    parts[0] = parts[0].toLowerCase();
    parts[1] = parts[1].toLowerCase().replace(/(\/\/)?/, '');
    parts[2] = parseInt(parts[2], 10) || 0;

    memo.push({
      protocol: parts[0]
    , hostname: parts[1]
    , port: parts[2]
    });
  }

  vals.map(function (val) {
    return parseProxy(val);
  });

  return memo;
}
function collectProxies(val, memo) {
  var vals = val.split(/,/g);

  function parseProxy(location) {
    // john.example.com
    // https:3443
    // http:john.example.com:3000
    // http://john.example.com:3000
    var parts = location.split(':');
    var dual = false;
    if (1 === parts.length) {
      // john.example.com -> :john.example.com:0
      parts[1] = parts[0];

      parts[0] = '';
      parts[2] = 0;

      dual = true;
    }
    else if (2 === parts.length) {
      // https:3443 -> https:*:3443
      parts[2] = parts[1];

      parts[1] = '*';
    }

    parts[0] = parts[0].toLowerCase();
    parts[1] = parts[1].toLowerCase().replace(/(\/\/)?/, '') || '*';
    parts[2] = parseInt(parts[2], 10) || 0;
    if (!parts[2]) {
      // TODO grab OS list of standard ports?
      if (!parts[0] || 'http' === parts[0]) {
        parts[2] = 80;
      }
      else if ('https' === parts[0]) {
        parts[2] = 443;
      }
      else {
        throw new Error("port must be specified - ex: tls:*:1337");
      }
    }

    memo.push({
      protocol: parts[0] || 'https'
    , hostname: parts[1]
    , port: parts[2] || 443
    });

    if (dual) {
      memo.push({
        protocol: 'http'
      , hostname: parts[1]
      , port: 80
      });
    }
  }

  vals.map(function (val) {
    return parseProxy(val);
  });

  return memo;
}

var program = require('commander');
program
  .version(pkg.version)
  //.command('jsurl <url>')
  .arguments('<url>')
  .action(function (url) {
    program.url = url;
  })
  .option('-k --insecure', 'Allow TLS connections to a Telebit Relay without valid certs (rejectUnauthorized: false)')
  .option('--locals <LIST>', 'comma separated list of <proto>:<port> to which matching incoming http and https should forward (reverse proxy). Ex: https:8443,smtps:8465', collectProxies, [ ]) // --reverse-proxies
  .option('--domains <LIST>', 'comma separated list of domain names to set to the tunnel (to capture a specific protocol to a specific local port use the format https:example.com:1337 instead). Ex: example.com,example.net', collectDomains, [ ])
  .option('--device [HOSTNAME]', 'Tunnel all domains associated with this device instead of specific domainnames. Use with --locals <proto>:<port>. Ex: macbook-pro.local (the output of `hostname`)')
  .option('--relay <URL>', 'the domain (or ip address) at which you are running Telebit Relay (the proxy)') // --proxy
  .option('--secret <STRING>', 'the same secret used by the Telebit Relay (used for JWT authentication)')
  .option('--token <STRING>', 'a pre-generated token for use with the Telebit Relay (instead of generating one with --secret)')
  .option('--agree-tos', 'agree to the Telebit Terms of Service (requires user validation)')
  .option('--email <EMAIL>', 'email address (or cloud address) for user validation')
  .option('--oauth3-url <URL>', 'Cloud Authentication to use (default: https://oauth3.org)')
  .parse(process.argv)
  ;


program.locals = (program.locals || []).concat(program.domains || []);
program.locals.forEach(function (proxy) {
  // Create a map from which we can derive a list of all domains we want forwarded to us.
  if (proxy.hostname && proxy.hostname !== '*') {
    domainsMap[proxy.hostname] = true;
  }

  // Create a map of which port different protocols should be forwarded to, allowing for specific
  // domains to go to different ports if need be (though that only works for HTTP and HTTPS).
  if (proxy.protocol && proxy.port) {
    services[proxy.protocol] = services[proxy.protocol] || {};

    if (/http/.test(proxy.protocol) && proxy.hostname && proxy.hostname !== '*') {
      services[proxy.protocol][proxy.hostname] = proxy.port;
    }
    else {
      if (services[proxy.protocol]['*'] && services[proxy.protocol]['*'] !== proxy.port) {
        console.error('cannot forward generic', proxy.protocol, 'traffic to multiple ports');
        process.exit(1);
      }
      else {
        services[proxy.protocol]['*'] = proxy.port;
      }
    }
  }
});

if (Object.keys(domainsMap).length === 0) {
  console.error('no domains specified');
  process.exit(1);
  return;
}

// Make sure we have generic ports for HTTP and HTTPS
services.https = services.https || {};
services.https['*'] = services.https['*'] || 8443;

services.http = services.http || {};
services.http['*'] = services.http['*'] || services.https['*'];

program.services = services;
*/

}());
