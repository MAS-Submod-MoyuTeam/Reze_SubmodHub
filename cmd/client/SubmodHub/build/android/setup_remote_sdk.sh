#!/usr/bin/env bash
set -e

export ANDROID_HOME=/opt/android-sdk
export ANDROID_SDK_ROOT=/opt/android-sdk
export ANDROID_NDK_HOME=/opt/android-sdk/ndk/26.3.11579264
export PATH=$ANDROID_HOME/cmdline-tools/latest/bin:$PATH

echo "Installing Android SDK packages..."
yes | sdkmanager --sdk_root=/opt/android-sdk "platforms;android-35" "build-tools;35.0.0" "ndk;26.3.11579264" "platform-tools"
echo "SDK and NDK installation completed."
