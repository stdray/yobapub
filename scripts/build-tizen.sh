#!/bin/bash
set -euo pipefail

AUTHOR_P12="/home/builder/tizen-studio-data/keystore/author/author.p12"
DIST_P12="/opt/tizen-studio/tools/certificate-generator/certificates/distributor/tizen-distributor-signer.p12"
DIST_CA="/opt/tizen-studio/tools/certificate-generator/certificates/distributor/tizen-distributor-ca.cer"

tizen certificate -a yobapub -p yobapub123 -f author

mkdir -p /tmp/tizen-profile
cat > /tmp/tizen-profile/profiles.xml <<XMLEOF
<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<profiles active="yobapub" version="3.1">
<profile name="yobapub">
<profileitem ca="" distributor="0" key="$AUTHOR_P12" password="yobapub123" rootca=""/>
<profileitem ca="$DIST_CA" distributor="1" key="$DIST_P12" password="tizenpkcs12passfordsigner" rootca=""/>
<profileitem ca="" distributor="2" key="" password="" rootca=""/>
</profile>
</profiles>
XMLEOF

tizen cli-config "default.profiles.path=/tmp/tizen-profile/profiles.xml"
rm -rf build
cp -r src build
tizen package -t wgt -s yobapub -- build
mv build/*.wgt .
