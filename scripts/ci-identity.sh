#!/bin/sh
set -eu
dir=${1:-$(mktemp -d)}
mkdir -p "$dir"
pass=$(/usr/bin/openssl rand -hex 16)
cat > "$dir/cert.cnf" <<'EOF'
[req]
distinguished_name = dn
prompt = no
x509_extensions = ext
[dn]
CN = OpenHut CI
[ext]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
EOF
/usr/bin/openssl req -x509 -newkey rsa:2048 -nodes -days 7 -config "$dir/cert.cnf" -keyout "$dir/key.pem" -out "$dir/cert.pem" 2>/dev/null
/usr/bin/openssl pkcs12 -export -inkey "$dir/key.pem" -in "$dir/cert.pem" -name 'OpenHut CI' -out "$dir/ci.p12" -passout "pass:$pass"
sudo security add-trusted-cert -d -r trustRoot -p codeSign -k /Library/Keychains/System.keychain "$dir/cert.pem" >&2
echo "CSC_LINK=$dir/ci.p12"
echo "CSC_KEY_PASSWORD=$pass"
echo "PASSKEY_PROFILE="
echo "PASSKEY_IDENTITY=OpenHut CI"
