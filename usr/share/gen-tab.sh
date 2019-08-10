# bash gen-tab.sh >> index.tab
#
# version	major	size	sha256	channel	os	arch	url
# v0.20.8	v0.20	25119710	4128ee6ef3dcc9c754dd1e46d1d68a217707017c223b417d34a6d0e56ab86f1a	stable	darwin	amd64	https://rootprojects.org/telebit/dist/stable/telebit-stable-darwin-amd64.tar.gz
for x in stable/*; do
  my_os="$(echo $x | cut -d '-' -f 3)"
  my_arch="$(echo $x | cut -d '-' -f 4 | cut -d '.' -f 1)"
  my_version="v0.20.8"
  my_major="v0.20"
  my_chan="stable"
  my_sha256=$(sha256sum -b "$x" | cut -d ' ' -f 1)
  my_size=$(ls -l "$x" | cut -d ' ' -f 5)
  printf "${my_version}\t${my_major}\t${my_size}\t${my_sha256}\t${my_chan}\t${my_os}\t${my_arch}\thttps://rootprojects.org/telebit/dist/$x\n"
done
