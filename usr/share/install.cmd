powershell.exe $ProgressPreference = 'SilentlyContinue'; Invoke-WebRequest https://rootprojects.org/telebit/dist/stable/telebit-stable-windows-amd64.zip -OutFile telebit.zip
mkdir %SYSTEMPROFILE%\.local\opt\

del /F /Q /S %SYSTEMPROFILE%\.local\opt\telebit-stable-windows-amd64 > NUL
rmdir /Q /S %SYSTEMPROFILE%\.local\opt\telebit-stable-windows-amd64
powershell.exe Expand-Archive -Force .\telebit.zip %SYSTEMPROFILE%\.local\opt\

%SYSTEMPROFILE%\.local\opt\telebit-stable-windows-amd64\bin\serviceman.exe stop telebit

del /F /Q /S %SYSTEMPROFILE%\.local\opt\telebit\* > NUL
rmdir /Q /S %SYSTEMPROFILE%\.local\opt\telebit
move %SYSTEMPROFILE%\.local\opt\telebit-stable-windows-amd64 %SYSTEMPROFILE%\.local\opt\telebit
%SYSTEMPROFILE%\.local\opt\telebit\bin\serviceman.exe add --name telebit %SYSTEMPROFILE%\.local\opt\telebit\bin\node %SYSTEMPROFILE%\.local\opt\telebit\bin\telebitd.js
%SYSTEMPROFILE%\.local\opt\telebit\bin\pathman.exe add %SYSTEMPROFILE%\.local\opt\telebit\bin
