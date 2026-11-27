import "./setup";
import { expect } from "chai";
import {
  isBlockedImportHostname,
  isPrivateIpAddress,
  validatePublicScrapeUrl,
} from "../../src/lib/urlSafety";

describe("import-profile SSRF validation", () => {
  it("flags private IPv4, loopback IPv6, bracketed IPv6, 0.0.0.0, and IPv4-mapped IPv6 addresses", () => {
    expect(isPrivateIpAddress("127.0.0.1")).to.equal(true);
    expect(isPrivateIpAddress("0.0.0.0")).to.equal(true);
    expect(isPrivateIpAddress("10.20.30.40")).to.equal(true);
    expect(isPrivateIpAddress("169.254.169.254")).to.equal(true);
    expect(isPrivateIpAddress("172.16.0.1")).to.equal(true);
    expect(isPrivateIpAddress("192.168.1.1")).to.equal(true);
    expect(isPrivateIpAddress("[::1]")).to.equal(true);
    expect(isPrivateIpAddress("::")).to.equal(true);
    expect(isPrivateIpAddress("::ffff:127.0.0.1")).to.equal(true);
    expect(isPrivateIpAddress("[::ffff:7f00:1]")).to.equal(true);
    expect(isPrivateIpAddress("104.21.45.12")).to.equal(false);
  });

  it("blocks local hostnames and private IP hosts", () => {
    expect(isBlockedImportHostname("localhost")).to.equal(true);
    expect(isBlockedImportHostname("0.0.0.0")).to.equal(true);
    expect(isBlockedImportHostname("metadata.google.internal")).to.equal(true);
    expect(isBlockedImportHostname("[::1]")).to.equal(true);
    expect(isBlockedImportHostname("[::ffff:7f00:1]")).to.equal(true);
    expect(isBlockedImportHostname("www.twitch.tv")).to.equal(false);
  });

  it("rejects non-HTTPS URLs, private IPs, and DNS resolutions returning RFC1918 addresses", async () => {
    const httpRes = await validatePublicScrapeUrl("http://twitch.tv/kaba");
    expect(httpRes.ok).to.equal(false);

    const v6Loopback = await validatePublicScrapeUrl("https://[::1]/admin");
    expect(v6Loopback.ok).to.equal(false);

    const v4Mapped = await validatePublicScrapeUrl(
      "https://[::ffff:127.0.0.1]/latest"
    );
    expect(v4Mapped.ok).to.equal(false);

    const zeroIp = await validatePublicScrapeUrl("https://0.0.0.0/");
    expect(zeroIp.ok).to.equal(false);

    const dnsRebind = await validatePublicScrapeUrl("https://evil.example.com", async () => [
      { address: "10.0.0.5" },
    ]);
    expect(dnsRebind.ok).to.equal(false);

    const validPublic = await validatePublicScrapeUrl(
      "https://twitch.tv/kaba",
      async () => [{ address: "151.101.66.167" }]
    );
    expect(validPublic.ok).to.equal(true);
  });
});
