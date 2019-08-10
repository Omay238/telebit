'use strict';

// use pathman and serviceman to make telebit ready

var spawn = require('child_process').spawn;
var os = require('os');
var path = require('path');
var ext = /^win/i.test(os.platform()) ? '.exe' : '';

function run(bin, args) {
	return new Promise(function(resolve, reject) {
		var runner = spawn(path.join(bin + ext), args, {
			windowsHide: true
		});
		var out = '';
		runner.stdout.on('data', function(chunk) {
			var txt = chunk.toString('utf8');
			out += txt;
		});
		runner.stderr.on('data', function(chunk) {
			var txt = chunk.toString('utf8');
			out += txt;
		});
		runner.on('exit', function(code) {
			if (
				0 !== code &&
				!/service matching/.test(out) &&
				!/no pid file/.test(out)
			) {
				console.error(out);
				reject(
					new Error("exited with non-zero status code '" + code + "'")
				);
				return;
			}
			resolve({ code: code });
		});
	});
}

var confpath = path.join(os.homedir(), '.config/telebit');
require('mkdirp')(confpath, function(err) {
	if (err) {
		console.error("Error creating config path '" + confpath + "':");
		console.error(err);
	}
	// not having a config is fine
});

run('serviceman', ['stop', 'telebit']).catch(function(e) {
	// TODO ignore
	console.error(e.message);
});
