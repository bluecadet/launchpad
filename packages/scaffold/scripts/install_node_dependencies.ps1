# Install runtime dependencies

# Choco's refreshenv command can't seem to load NPM into the path on the fly
# so we need to temporarily add NodeJS to the path here.
# $env:Path += ";C:\ProgramData\nvm\;"

# choco uninstall nodejs
# choco install nvm --version 1.1.9 -y
# nvm install 17.5.0
# nvm use 17.5.0

$env:Path += ";$env:ProgramFiles\nodejs\;"

# new-item -path alias:npm -value "C:\Program Files\nodejs\npm"

# cmd /c npm install -g npm@8.5.1
npm i -g npm@latest

Push-Location '../../';
npm install
Pop-Location;
