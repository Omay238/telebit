package main

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"fmt"
	"io"
	"io/ioutil"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

type pkg struct {
	os   string
	arch string
	ext  string
	exe  string
}

// ReaderAtCloser is just what it sounds
type ReaderAtCloser interface {
	io.ReaderAt
	io.Reader
	io.Closer
}

func main() {
	nodeArches := map[string]string{
		"windows": "win",
		"darwin":  "darwin",
		"linux":   "linux",
		"amd64":   "x64",
		"386":     "x86",
		"armv7":   "armv7l",
		"armv6":   "armv6l",
		"arm64":   "arm64",
		//"armv8":   "arm64",
	}

	pkgs := []pkg{
		pkg{os: "darwin", arch: "amd64", ext: "tar.gz"},
		pkg{os: "windows", arch: "amd64", ext: "zip", exe: ".exe"},
		pkg{os: "windows", arch: "386", ext: "zip", exe: ".exe"},
		pkg{os: "linux", arch: "amd64", ext: "tar.gz"},
		//pkg{os: "linux", arch: "armv8", ext: "tar.gz"},
		pkg{os: "linux", arch: "arm64", ext: "tar.gz"},
		pkg{os: "linux", arch: "armv7", ext: "tar.gz"},
		pkg{os: "linux", arch: "armv6", ext: "tar.gz"},
	}

	nodev := "10.16.0"
	release := "stable"

	// temp file for the zip
	// TODO use mktemp
	f, err := os.OpenFile(fmt.Sprintf("telebit-%s.zip", release), os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0644)
	if nil != err {
		panic(err)
	}

	// get from trusted git source
	turl := fmt.Sprintf("https://git.rootprojects.org/root/telebit.js/archive/%s.zip", release)
	resp, err := http.Get(turl)
	if nil != err {
		panic(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 || resp.StatusCode < 200 {
		log.Fatal("Bad deal on telebit download:", resp.Status)
	}

	_, err = io.Copy(f, resp.Body)
	if nil != err {
		panic(err)
	}
	err = f.Sync()
	if nil != err {
		panic(err)
	}

	// Get a copy of all the node modules
	npmdir := "tmp-package-modules"
	// TODO save bits /*
	err = os.RemoveAll(npmdir)
	if nil != err {
		panic(err)
	}
	err = os.MkdirAll(npmdir, 0755)
	if nil != err {
		panic(err)
	}
	b, err := ioutil.ReadFile("package.json")
	if nil != err {
		panic(err)
	}
	err = ioutil.WriteFile(filepath.Join(npmdir, "package.json"), b, 0644)
	if nil != err {
		panic(err)
	}
	nodeExec, err := exec.LookPath("node")
	if nil != err {
		panic(err)
	}
	npmExec, err := exec.LookPath("npm")
	if nil != err {
		panic(err)
	}
	cmd := exec.Command(nodeExec, npmExec, "install")
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Dir = npmdir
	err = cmd.Run()
	if nil != err {
		panic(err)
	}
	//*/

	for i := range pkgs {
		pkg := pkgs[i]

		arch := pkg.arch
		if "arm64" == arch {
			// TODO switch the pathman and serviceman URLs
			arch = "armv8"
		}
		fmt.Printf("\nOS: %s\nArch: %s\n", pkg.os, arch)

		// Create a fresh directory for this telebit release
		outdir := fmt.Sprintf("telebit-%s-%s-%s", release, pkg.os, pkg.arch)
		fmt.Printf("(clean) Release:%s\n", outdir)
		err := os.RemoveAll(outdir)
		if nil != err {
			panic(err)
		}

		nos := nodeArches[pkg.os]
		narch := nodeArches[pkg.arch]

		// Grab the node files
		npath := fmt.Sprintf("node-v%s-%s-%s", nodev, nos, narch)
		nfile := fmt.Sprintf("%s.%s", npath, pkg.ext)
		// TODO check remote filesize anyway as a quick sanity check
		nurl := fmt.Sprintf("https://nodejs.org/download/release/v%s/%s", nodev, nfile)
		err = download("node package", nurl, nfile, false)
		if nil != err {
			panic(err)
		}

		// lay down the node directory first
		fmt.Printf("Unpacking %s %s\n", nfile, pkg.ext)
		switch pkg.ext {
		case "zip":
			z, err := os.Open(nfile)
			if nil != err {
				panic(err)
			}
			s, err := z.Stat()
			if nil != err {
				panic(err)
			}
			strip := 1
			if "windows" == pkg.os {
				// re-nest into "bin" for consistency
				err = unzip(z, s.Size(), filepath.Join(outdir, "bin"), strip)
				// handle the special case of git bash
				sh := strings.Join([]string{
					`#!/usr/bin/env bash`,
					`"$(dirname "$0")/node.exe" "$@"`,
					`exit $?`,
				}, "\n")
				script := filepath.Join(outdir, "bin", "node")
				if err := ioutil.WriteFile(script, []byte(sh), 0755); nil != err {
					panic(err)
				}
			} else {
				err = unzip(z, s.Size(), outdir, strip)
			}
			if nil != err {
				panic(err)
			}
		case "tar.gz":
			// SAVE ON BITS /*
			tgz, err := os.Open(nfile)
			if nil != err {
				panic(err)
			}
			defer tgz.Close()
			tarfile, err := gzip.NewReader(tgz)
			if nil != err {
				panic(err)
			}
			// TODOD XXX turn back on
			strip := 1
			err = untar(tarfile, outdir, strip)
			if nil != err {
				panic(err)
			}
			//*/
		default:
			panic(fmt.Errorf("%s", "Liar!!"))
		}

		// TODO how to handle node modules?
		// overlay our stuff on top of the node release package
		z, err := os.Open(fmt.Sprintf("telebit-%s.zip", release))
		fmt.Printf("Overlaying %s\n", outdir)
		if nil != err {
			panic(err)
		}
		defer z.Close()

		s, err := z.Stat()
		if nil != err {
			panic(err)
		}
		strip := 1
		if err := unzip(z, s.Size(), outdir, strip); nil != err {
			panic(err)
		}

		pr, pw := io.Pipe()
		go func() {
			tw := tar.NewWriter(pw)
			defer tw.Close()
			//fis, err := ioutil.ReadDir(npmdir)
			fi, err := os.Stat(npmdir)
			if nil != err {
				panic("stat:" + err.Error())
			}
			//err = tarDir(tw, npmdir, fis, "")
			err = tarEntry(tw, "", fi, "")
			if nil != err {
				panic("tarError:" + err.Error())
			}
		}()

		err = untar(pr, outdir, 1)
		if nil != err {
			panic("untarError:" + err.Error())
		}

		// Get pathman for the platform
		pathmanURL := fmt.Sprintf(
			"https://rootprojects.org/pathman/dist/%s/%s/pathman"+pkg.exe,
			pkg.os,
			arch,
		)
		pathmanFile := filepath.Join(outdir, "node_modules/.bin", "pathman") + pkg.exe
		err = download("pathman", pathmanURL, pathmanFile, true)
		if nil != err {
			panic(err)
		}
		if ".exe" == pkg.exe {
			sh := strings.Join([]string{
				`#!/usr/bin/env bash`,
				`"$(dirname "$0")/pathman.exe" "$@"`,
				`exit $?`,
			}, "\n")
			script := filepath.Join(outdir, "node_modules/.bin", "pathman")
			if err := ioutil.WriteFile(script, []byte(sh), 0755); nil != err {
				panic(err)
			}
		}

		// Get serviceman for the platform
		servicemanURL := fmt.Sprintf(
			"https://rootprojects.org/serviceman/dist/%s/%s/serviceman"+pkg.exe,
			pkg.os,
			arch,
		)
		servicemanFile := filepath.Join(outdir, "node_modules/.bin", "serviceman") + pkg.exe
		err = download("serviceman", servicemanURL, servicemanFile, true)
		if nil != err {
			panic(err)
		}
		if ".exe" == pkg.exe {
			sh := strings.Join([]string{
				`#!/usr/bin/env bash`,
				`"$(dirname "$0")/serviceman.exe" "$@"`,
				`exit $?`,
			}, "\n")
			script := filepath.Join(outdir, "node_modules/.bin", "serviceman")
			if err := ioutil.WriteFile(script, []byte(sh), 0755); nil != err {
				panic(err)
			}
		}

		// Write out the packaged deliverable
		f, err := os.OpenFile(outdir+"."+pkg.ext, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0644)
		defer f.Close()
		if nil != err {
			panic(err)
		}

		//fis, err := ioutil.ReadDir(npmdir)
		fi, err := os.Stat(outdir)
		if nil != err {
			panic("stat:" + err.Error())
		}

		switch pkg.ext {
		case "zip":
			err = Zip(f, outdir, "")
			if nil != err {
				panic("zipError:" + err.Error())
			}
		case "tar.gz":
			// Write out the tar

			zw := gzip.NewWriter(f)
			defer zw.Close()
			tw := tar.NewWriter(zw)
			defer tw.Close()

			// TODO create Tar() in go-examples
			//err = tarDir(tw, outdir, fis, "")
			err = tarEntry(tw, "", fi, outdir)
			if nil != err {
				panic("tarError:" + err.Error())
			}

			// Explicitly close in the correct order
			err = tw.Close()
			if nil != err {
				panic(err)
			}
			err = zw.Close()
			if nil != err {
				panic(err)
			}
		default:
			panic(fmt.Errorf("%s", "Liar!!"))
		}

		err = f.Close()
		if nil != err {
			panic(err)
		}
		fmt.Println("wrote", outdir+"."+pkg.ext)

	}

	fmt.Printf("Done.\n")
}

func download(title string, nurl string, nfile string, exec bool) error {
	if _, err := os.Stat(nfile); nil == err {
		return nil
	}
	// doesn't exist, go grab it
	fmt.Printf("Downloading %s to %s\n", nurl, nfile)
	resp, err := http.Get(nurl)
	if nil != err {
		return err
	}
	if resp.StatusCode >= 300 || resp.StatusCode < 200 {
		log.Fatal("Bad deal on download:", resp.Status)
	}
	defer resp.Body.Close()

	// Stream it in locally
	fmt.Printf("Streaming %s to %s\n", nurl, nfile)
	fmode := os.FileMode(0644)
	if exec {
		fmode = os.FileMode(0755)
	}
	nf, err := os.OpenFile(nfile, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, fmode)
	_, err = io.Copy(nf, resp.Body)
	if nil != err {
		return err
	}
	return nf.Sync()
}

func untar(t io.Reader, outdir string, strip int) error {
	tr := tar.NewReader(t)
	for {
		header, err := tr.Next()
		if err == io.EOF {
			break
		}
		if nil != err {
			return err
		}

		fpath := stripPrefix(header.Name, strip)
		fpath = filepath.Join(outdir, fpath)
		switch header.Typeflag {
		case tar.TypeLink:
			// ignore hard links
		case tar.TypeSymlink:
			//fmt.Println("untarSym:", fpath)
			// Note: the link itself is always a file, even when it represents a directory
			lpath := filepath.Join(filepath.Dir(fpath), header.Linkname)
			if !strings.HasPrefix(lpath+string(os.PathSeparator), outdir+string(os.PathSeparator)) {
				return fmt.Errorf("Malicious link path: %s", header.Linkname)
			}
			if err := os.Symlink(header.Linkname, fpath); nil != err {
				return err
			}
		case tar.TypeDir:
			//fmt.Println("untarDir:", fpath)
			/*
				// TODO
				if err := os.Lchown(dst); err != nil {
					return err
				}
			*/
			// gonna use the same perms as were set previously here
			// should be fine (i.e. we want 755 for execs on *nix)
			_, err := safeOpen(header.FileInfo(), os.FileMode(header.Mode), fpath, outdir)
			if nil != err {
				return err
			}
		case tar.TypeReg:
			//fmt.Println("untarReg:", fpath)
			/*
				// TODO
				if err := os.Lchown(dst); err != nil {
					return err
				}
			*/
			// gonna use the same perms as were set previously here
			// should be fine (i.e. we want 755 for execs on *nix)
			out, err := safeOpen(header.FileInfo(), os.FileMode(header.Mode), fpath, outdir)
			if nil != err {
				return err
			}
			defer out.Close()
			_, err = io.Copy(out, tr)
			if nil != err {
				return err
			}
			err = out.Close()
			if nil != err {
				return err
			}
		default:
			fmt.Printf("[debug] odd type %s (%c)", fpath, header.Typeflag)
		}
	}
	return nil
}

func unzip(z io.ReaderAt, size int64, outdir string, strip int) error {
	zr, err := zip.NewReader(z, size)
	if nil != err {
		return err
	}

	for i := range zr.File {
		f := zr.File[i]

		fpath := stripPrefix(f.Name, strip)
		fpath = filepath.Join(outdir, fpath)
		out, err := safeOpen(f.FileInfo(), f.Mode(), fpath, outdir)
		if nil != err {
			return err
		}
		if f.FileInfo().IsDir() {
			continue
		}
		// this is actually function scope (not loop scope)
		defer out.Close()

		zf, err := f.Open()
		if nil != err {
			return err
		}
		defer zf.Close()

		_, err = io.Copy(out, zf)
		if nil != err {
			return err
		}

		// close explicitly within loop scope
		err = out.Close()
		if nil != err {
			return err
		}
		err = zf.Close()
		if nil != err {
			return err
		}
	}
	return nil
}

func stripPrefix(fpath string, strip int) string {
	// /foo/bar/baz/ => foo/bar/baz
	// strip 1 => bar/baz
	fpath = strings.Trim(filepath.ToSlash(fpath), "/")
	parts := []string{}
	if "" != fpath {
		parts = strings.Split(fpath, "/")
	}
	if strip > 0 {
		n := len(parts)
		if strip > n {
			strip = n
		}
		if 0 != len(parts) {
			parts = parts[strip:]
		}
	}

	return strings.Join(parts, "/")
}

// given the path return a file, tell that it's a directory, or error out
func safeOpen(fi os.FileInfo, fm os.FileMode, fpath string, outdir string) (io.WriteCloser, error) {
	// Keep it clean
	// https://github.com/snyk/zip-slip-vulnerability
	cleanpath, _ := filepath.Abs(filepath.Clean(fpath))
	cleandest, _ := filepath.Abs(filepath.Clean(outdir))

	// foo/ foo => foo// foo/
	// foo/ foo/bar.md => foo// foo/bar.md/
	if !strings.HasPrefix(cleanpath+string(os.PathSeparator), cleandest+string(os.PathSeparator)) {
		return nil, fmt.Errorf("Malicious file path: %s", fpath)
	}
	fpath = cleanpath

	if fi.IsDir() {
		err := os.MkdirAll(fpath, fm)
		if nil != err {
			return nil, err
		}
		return nil, err
	}

	if err := os.MkdirAll(filepath.Dir(fpath), 0755); nil != err {
		return nil, err
	}

	out, err := os.OpenFile(fpath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, fm)
	if nil != err {
		return nil, err
	}

	return out, nil
}

// simpler to tar and untar than to have separate code to copy and to tar
func tarDir(tw *tar.Writer, src string, fis []os.FileInfo, trim string) error {
	//fmt.Println("tarDir:", src)
	for i := range fis {
		fi := fis[i]

		//fmt.Println("tarEntry:", src)
		if err := tarEntry(tw, src, fi, trim); nil != err {
			return err
		}
	}

	return nil
}

func tarEntry(tw *tar.Writer, src string, fi os.FileInfo, trim string) error {
	// gotta get perms
	/*
		stat, ok := info.Sys().(*syscall.Stat_t)
		if !ok {
			return fmt.Errorf("syscall failed for %q", src)
		}
		// TODO uid, username
		Uid: int(stat.Uid),
		Gid: int(stat.Gid),
	*/

	src = filepath.Join(src, fi.Name())
	entryName := strings.TrimPrefix(strings.TrimPrefix(src, trim), "/")

	switch fi.Mode() & os.ModeType {
	case os.ModeSymlink:
		//fmt.Println("tarSym:", src)
		// TODO make sure that this is within the directory
		targetpath, err := os.Readlink(src)
		if nil != err {
			return err
		}

		h, err := tar.FileInfoHeader(fi, targetpath)
		if nil != err {
			return err
		}
		h.Name = entryName

		err = tw.WriteHeader(h)
		if nil != err {
			return err
		}

		// return to skip chmod
		return nil
	case os.ModeDir:
		// directories must end in / for go
		h, err := tar.FileInfoHeader(fi, "")
		if nil != err {
			return err
		}
		h.Name = entryName
		h.Name = strings.TrimPrefix(h.Name+"/", "/")

		//fmt.Printf("tarIsDir: %q %q\n", src, h.Name)
		if "" != h.Name {
			if err := tw.WriteHeader(h); nil != err {
				return err
			}
		}

		//fmt.Println("tarReadDir:", src)
		fis, err := ioutil.ReadDir(src)
		if nil != err {
			return err
		}

		return tarDir(tw, src, fis, trim)
	default:
		//fmt.Println("tarDefault:", src)
		if !fi.Mode().IsRegular() {
			return fmt.Errorf("Unsupported file type: %s", src)
		}

		h, err := tar.FileInfoHeader(fi, "")
		if nil != err {
			return err
		}
		h.Name = entryName
		if err := tw.WriteHeader(h); nil != err {
			return err
		}

		r, err := os.Open(src)
		defer r.Close()
		if nil != err {
			return err
		}

		if _, err := io.Copy(tw, r); nil != err {
			return err
		}
	}

	return nil
}

// Zip walks `src`, omitting `trim`, writing to `w`
func Zip(w io.Writer, src string, trim string) error {
	zw := zip.NewWriter(w)
	defer zw.Close()

	return filepath.Walk(src, func(path string, fi os.FileInfo, err error) error {
		// path includes fi.Name() already
		if nil != err {
			fmt.Println("warning: skipped", path+": ", err)
			return nil
		}

		zipOne(zw, path, fi, trim)
		return nil
	})
}

func zipOne(zw *zip.Writer, path string, fi os.FileInfo, trim string) error {
	h, err := zip.FileInfoHeader(fi)
	if nil != err {
		return err
	}
	h.Name = strings.TrimPrefix(strings.TrimPrefix(path, trim), string(filepath.Separator))

	if fi.IsDir() {
		//fmt.Printf("directory: %s\n\t%q\n", path, h.Name)
		return zipDirectory(zw, h)
	}

	// Allow zipping a single file
	if "" == h.Name {
		h.Name = path
	}
	if fi.Mode().IsRegular() {
		//fmt.Printf("file: %s\n\t%q\n", path, h.Name)
		return zipFile(zw, h, path)
	}

	if os.ModeSymlink == (fi.Mode() & os.ModeType) {
		//fmt.Printf("symlink: %s\n\t%q\n", path, h.Name)
		return zipSymlink(zw, h, path)
	}

	fmt.Fprintf(os.Stderr, "skipping: %s\n\t(irregular file type)\n", path)
	return nil
}

func zipDirectory(zw *zip.Writer, h *zip.FileHeader) error {
	// directories must end in / for go
	h.Name = strings.TrimPrefix(h.Name+"/", "/")

	// skip top-level, trimmed directory
	if "" == h.Name {
		return nil
	}

	if _, err := zw.CreateHeader(h); nil != err {
		return err
	}

	return nil
}

func zipFile(zw *zip.Writer, h *zip.FileHeader, path string) error {
	r, err := os.Open(path)
	if nil != err {
		return err
	}
	defer r.Close()

	// Files should be zipped (not dirs, and symlinks... meh)
	// TODO investigate if files below a certain size shouldn't be deflated
	h.Method = zip.Deflate
	w, err := zw.CreateHeader(h)
	if nil != err {
		return err
	}

	if _, err := io.Copy(w, r); nil != err {
		return err
	}

	return nil
}

func zipSymlink(zw *zip.Writer, h *zip.FileHeader, path string) error {
	w, err := zw.CreateHeader(h)
	if nil != err {
		return err
	}

	// TODO make sure that this is within the root directory
	targetpath, err := os.Readlink(path)
	if nil != err {
		return err
	}
	if _, err := w.Write([]byte(targetpath)); nil != err {
		return err
	}

	return nil
}
