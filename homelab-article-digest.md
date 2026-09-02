# Article Digest -- Proof Points

## Private AI-supported operations sandbox / homelab

- Built and operate a private AI-supported operations sandbox with a clear operating contract: every request has a path, an owner, a trace, and a decision rule.
- Designed an intake and routing layer for email, Telegram, cron, hooks, and executive requests; specialist agents execute within domain boundaries, with audit logging and escalation for material decisions.
- Built and operate a dual-network DNS/DHCP appliance on repurposed hardware: a retired 2013 MacBook Pro running Debian and Pi-hole across two independent ISP networks.
- Administer the homelab remotely over SSH and Tailscale. Diagnosed a relocation outage by identifying a static-only Wi-Fi configuration with no default route, then recovered access from a second machine on the same LAN.
- Diagnosed degraded Wi-Fi using ground-truth radio statistics rather than misleading driver-reported values; corrected physical placement and verified the link improved from -97 dBm to -41 dBm.
- Migrated DHCP authority from an ISP gateway using authoritative lease reclaim and tag-scoped dnsmasq ranges. Verified the full DHCP handshake in server logs and from the client side, including end-to-end Pi-hole blocking across both networks, with zero data loss.
- Transferable engineering disciplines: systems thinking, observability, data-grounded diagnosis, reversible changes, failure recovery, auditability, verification, and human escalation boundaries.
- Truthful boundary: this is a private homelab and portfolio case study, not an enterprise production platform. Use it as evidence of hands-on systems judgment and operational discipline, not as enterprise-scale infrastructure experience.
