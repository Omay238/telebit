agree_tos: true                 # agree to the Telebit, Greenlock, and Let's Encrypt TOSes
community_member: true          # receive infrequent relevant updates
telemetry: true                 # contribute to project telemetric data
ssh_auto: 22                    # forward ssh-looking packets, from any connection, to port 22
remote_options:
  https_redirect: true          # redirect http to https remotely (default)
local_ports:                    # ports to forward
  3001: 'http'
  9443: 'https'
