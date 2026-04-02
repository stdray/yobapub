FROM eclipse-temurin:17-jdk-jammy

# ── Common tools ──
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl unzip zip expect libncurses5 gettext \
      ruby libxml2-utils python3 ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# ── Android SDK ──
ENV ANDROID_HOME=/opt/android-sdk
ENV PATH="${ANDROID_HOME}/cmdline-tools/latest/bin:${ANDROID_HOME}/platform-tools:${PATH}"

ARG CMDLINE_TOOLS_VERSION=11076708
RUN mkdir -p "${ANDROID_HOME}/cmdline-tools" && \
    curl -fsSL "https://dl.google.com/android/repository/commandlinetools-linux-${CMDLINE_TOOLS_VERSION}_latest.zip" \
      -o /tmp/cmdline-tools.zip && \
    unzip -q /tmp/cmdline-tools.zip -d "${ANDROID_HOME}/cmdline-tools" && \
    mv "${ANDROID_HOME}/cmdline-tools/cmdline-tools" "${ANDROID_HOME}/cmdline-tools/latest" && \
    rm /tmp/cmdline-tools.zip

RUN yes | sdkmanager --licenses > /dev/null 2>&1 && \
    sdkmanager "platforms;android-35" "build-tools;35.0.0"

# ── Tizen Studio CLI ──
# Tizen installer refuses root, so install as 'builder' user.
# Tizen CLI hardcodes config path relative to install dir, so we keep it
# in /home/builder/tizen-studio and symlink to /opt for PATH convenience.
ENV TIZEN_HOME=/opt/tizen-studio
ENV PATH="${TIZEN_HOME}/tools/ide/bin:${TIZEN_HOME}/tools:${PATH}"

RUN useradd -m builder

ARG TIZEN_STUDIO_VERSION=6.0
RUN curl -fSL --retry 5 --retry-delay 10 --retry-all-errors \
      "https://download.tizen.org/sdk/Installer/tizen-studio_${TIZEN_STUDIO_VERSION}/web-cli_Tizen_Studio_${TIZEN_STUDIO_VERSION}_ubuntu-64.bin" \
      -o /tmp/tizen-installer.bin && \
    chmod +x /tmp/tizen-installer.bin && \
    su -l builder -c "/tmp/tizen-installer.bin --accept-license /home/builder/tizen-studio" && \
    ln -s /home/builder/tizen-studio ${TIZEN_HOME} && \
    chmod -R a+rw /home/builder/tizen-studio/tools && \
    rm /tmp/tizen-installer.bin

WORKDIR /build
