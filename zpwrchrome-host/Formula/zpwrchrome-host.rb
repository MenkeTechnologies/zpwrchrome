class ZpwrchromeHost < Formula
  desc "Native messaging host for the zpwrchrome Chrome extension"
  homepage "https://github.com/MenkeTechnologies/zpwrchrome"
  license "MIT"
  version "0.8.0"

  on_macos do
    on_arm do
      url "https://github.com/MenkeTechnologies/zpwrchrome/releases/download/host-v0.8.0/zpwrchrome-host-v0.8.0-aarch64-apple-darwin.tar.gz"
      sha256 "403a72466fbeca81486bd44771fd86579984e23bb77ebd1520d0513a1ca70017"
    end
    on_intel do
      url "https://github.com/MenkeTechnologies/zpwrchrome/releases/download/host-v0.8.0/zpwrchrome-host-v0.8.0-x86_64-apple-darwin.tar.gz"
      sha256 "REPLACE_AFTER_CI_x86_64_APPLE_DARWIN"
    end
  end

  on_linux do
    on_intel do
      url "https://github.com/MenkeTechnologies/zpwrchrome/releases/download/host-v0.8.0/zpwrchrome-host-v0.8.0-x86_64-unknown-linux-gnu.tar.gz"
      sha256 "REPLACE_AFTER_CI_x86_64_UNKNOWN_LINUX_GNU"
    end
    on_arm do
      url "https://github.com/MenkeTechnologies/zpwrchrome/releases/download/host-v0.8.0/zpwrchrome-host-v0.8.0-aarch64-unknown-linux-gnu.tar.gz"
      sha256 "REPLACE_AFTER_CI_aarch64_UNKNOWN_LINUX_GNU"
    end
  end

  def install
    bin.install "zpwrchrome-host"
  end

  def caveats
    <<~EOS
      To finish setup, register the host with your extension's ID
      (find it at chrome://extensions, with Developer mode on):

          zpwrchrome-host --install <ext-id>

      That writes com.menketechnologies.zpwrchrome.json into every
      Chromium-family browser config dir on this machine. Reload the
      extension afterward.
    EOS
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/zpwrchrome-host -version")
  end
end
