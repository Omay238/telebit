# stunnel.js

A client that works in combination with [stunneld.js](https://github.com/Daplie/node-tunnel-server)
to allow you to serve http and https from any computer, anywhere through a secure tunnel.

* CLI
* Library

CLI
===

Installs as `stunnel.js` with the alias `jstunnel`
(for those that regularly use `stunnel` but still like commandline completion).

### Install

```bash
npm install -g stunnel
```

### Advanced Usage

How to use `stunnel.js` with your own instance of `stunneld.js`:

```bash
stunnel.js --locals john.example.com --stunneld wss://tunnel.example.com:443 --secret abc123
```

```bash
stunnel.js \
  --locals http:john.example.com:3000,https:john.example.com \
  --stunneld wss://tunnel.example.com:443 \
  --secret abc123
```

```
--secret          the same secret used by stunneld (used for authentication)
--locals          comma separated list of <proto>:<servername>:<port> to which
                  incoming http and https should be forwarded
--stunneld        the domain or ip address at which you are running stunneld.js
-k, --insecure    ignore invalid ssl certificates from stunneld
```

### Usage

**NOT YET IMPLEMENTED**

Daplie's tunneling service is not yet publicly available.

**Terms of Service**: The Software and Services shall be used for Good, not Evil.
Examples of good: education, business, pleasure. Examples of evil: crime, abuse, extortion.

```bash
stunnel.js --agree-tos --email john@example.com --locals http:john.example.com:4080,https:john.example.com:8443
```

Library
=======

### Example

```javascript
var stunnel = require('stunnel');

stunnel.connect({
  stunneld: 'wss://tunnel.example.com'
, token: '...'
, locals: [
    // defaults to sending http to local port 80 and https to local port 443
    { hostname: 'doe.net' }

    // sends both http and https to local port 3000 (httpolyglot)
  , { protocol: 'https', hostname: 'john.doe.net', port: 3000 }

    // send http to local port 4080 and https to local port 8443
  , { protocol: 'https', hostname: 'jane.doe.net', port: 4080 }
  , { protocol: 'https', hostname: 'jane.doe.net', port: 8443 }
  ]

, net: require('net')
, insecure: false
});
```

* You can get sneaky with `net` and provide a `createConnection` that returns a `streams.Duplex`.

### Token

```javascript
var tokenData = { domains: [ 'doe.net', 'john.doe.net', 'jane.doe.net' ] }
var secret = 'shhhhh';
var token = jwt.sign(tokenData, secret);
```

### net

Let's say you want to handle http requests in-process
or decrypt https before passing it to the local http handler.
You could do a little magic like this:

```
var Dup = {
  write: function (chunk, encoding, cb) {
    this.__my_socket.write(chunk, encoding);
    cb();
  }
, read: function (size) {
    var x = this.__my_socket.read(size);
    if (x) { this.push(x); }
  }
};

stunnel.connect({
  // ...
, net: {
  createConnection: function (info, cb) {
    // data is the hello packet / first chunk
    // info = { data, servername, port, host, remoteAddress: { family, address, port } }
    // socket = { write, push, end, events: [ 'readable', 'data', 'error', 'end' ] };

    var myDuplex = new (require('streams').Duplex);

    myDuplex.__my_socket = socket;
    myDuplex._write = Dup.write;
    myDuplex._read = Dup.read;

    myDuplex.remoteFamily = info.remoteFamily;
    myDuplex.remoteAddress = info.remoteAddress;
    myDuplex.remotePort = info.remotePort;

    // socket.local{Family,Address,Port}
    myDuplex.localFamily = 'IPv4';
    myDuplex.localAddress = '127.0.01';
    myDuplex.localPort = info.port;

    httpsServer.emit('connection', myDuplex);

    return myDuplex;
  }
});
```
