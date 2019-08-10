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
		runner.stdout.on('data', function(chunk) {
			console.info(chunk.toString('utf8'));
		});
		runner.stderr.on('data', function(chunk) {
			console.error(chunk.toString('utf8'));
		});
		runner.on('exit', function(code) {
			if (0 !== code) {
				reject(
					new Error("exited with non-zero status code '" + code + "'")
				);
				return;
			}
			resolve({ code: code });
		});
	});
}

run('serviceman', [
	'add',
	'--name',
	'telebit',
	'--title',
	'Telebit',
	'--rdns',
	'io.telebit.remote.telebit',
	path.resolve(__dirname, '..', 'bin', 'telebit.js'),
	'--',
	'daemon',
	'--config',
	path.join(os.homedir(), '.config/telebit/telebitd.yml')
])
	.then(function() {})
	.catch(function(e) {
		console.error(e.message);
	});
