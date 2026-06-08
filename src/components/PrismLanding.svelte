<script lang="ts">
    import { IconArrowRight, IconExternalLink, OuterLink, Text } from "@imput/helium-prism";

    import logo from "../assets/images/ppologo.png?url";
    import aadish from "../assets/images/av_ppo.jpg?url";
    import victoria from "../assets/images/vm_ppo.png?url";
    import grace from "../assets/images/gz_ppo.png?url";
    import vinayak from "../assets/images/vv_ppo.png?url";
    import weston from "../assets/images/wy_ppo.jpeg?url";
    import render from "../assets/images/pixelsattransparentrender.png?url";

    const mission = [
        {
            title: "Do it",
            body: "Getting to orbit is genuinely difficult; even university teams with decades of experience can fail. Due to our extremely limited budget, we're building everything from scratch and relying on commercial off-the-shelf hardware in the majority of cases. The chances of failure are high, which makes the mission all the more exhilarating.",
        },
        {
            title: "Take an image of the Earth",
            body: "We aim to 1) detumble (stop spinning after being released from the launch vehicle), 2) establish contact with the Project Pixel Orbital team on ground with our LoRa UHF comms pipeline, 3) capture an image of the Earth using the onboard OV2640 camera, and 4) downlink the image.",
        },
        {
            title: "Learn stuff",
            body: "Building PixelSat I is a massive endeavour, not just technically, but also because every member is learning and growing as we go. From embedded Rust to CAD software to control theory, we're pushing our knowledge and gaining new skills along the way.",
        },
        {
            title: "Inspire other kids",
            body: "We want to prove to students around the world that it's possible to build a CubeSat from scratch with no prior experience on a meager budget as a high school team, and hopefully get others to follow suit!"
        },
    ];

    const systems = [
        {
            title: "ADCS",
            body: "IMU, magnetometer, and sun sensor readings are merged and fused using an Extended Kalman Filter to estimate the spacecraft's attitude (orientation). Hand-wound magnetorquers are driven through a PID controller to set the satellite's angular velocity and orientation.",
        },
        {
            title: "Flight computer",
            body: "A STM32-series processor running the RTIC framework handles all onboard operations on a single core. All code is no_std Rust.",
        },
        {
            title: "Communications",
            body: "We use the 435 Megahertz ultra-high frequency band for communication, with the LoRa modulation scheme. Our transceiver is an E-Byte LoRa module which wraps a SemTech SX1262-based chip, connected to a tape measure antenna which is deployed via a burn wire into orbit.",
        },
        {
            title: "Power",
            body: "Our battery pack is a 4P3S 21700 (21mm x 70mm) lithium ion battery pack powered by high-efficiency solar panels. The satellite runs on a 5V bus regulated by a custom power controller. A dedicated watchdog chip resets the STM32 flight computer in case of a heartbeat failure.",
        },
    ];

    const team = [
        { name: "Weston Yoo", role: "Overall team lead", image: weston },
        { name: "Vinayak Vikram", role: "Electrical lead · software · structural", image: vinayak },
        { name: "Aadish Verma", role: "Comms lead · software", image: aadish },
        { name: "Victoria McLeod", role: "Structural Lead", image: victoria },
        { name: "Grace Zheng", role: "Structural · media", image: grace },
        { name: "Ashwin Naren", role: "Software BDFL/Lead · electrical · structural", initials: "AN", href: "https://arihant2math.github.io/" },
        { name: "Daphne F", role: "Outreach lead", initials: "DF" },
        { name: "Nathan Muruganantham · ADCS", role: "Electrical", initials: "NM" },
        { name: "Shiv Sareen", role: "Outreach · funding", initials: "SS" },
    ];

    const stats = [
        { value: "March 2027", label: "current launch target" },
        { value: "$10k", label: "hardware budget" },
        { value: "0", label: "adult supervision" },
    ];

    const snapshot = [
        ["Form factor", "3U CubeSat (100×100×300 mm)"],
        ["Orbit", "Sun-synchronous LEO @ 550km"],
        ["Structure", "Aluminum frame"],
        ["Comms", "UHF LoRa on 435 MHz"],
        ["Goal", "Capture & downlink image of the Earth"],
    ];
</script>

<div class="page-shell">
    <header class="topbar">
        <a class="brand" href="#top" aria-label="Project Pixel Orbital home">
            <img src={logo} alt="Project Pixel Orbital logo" />
            <div>
                <Text tag="div" class="brand-name">Project Pixel Orbital</Text>
            </div>
        </a>

        <nav class="nav-links" aria-label="Primary">
            <a href="#mission">Mission</a>
            <a href="#systems">Systems</a>
            <a href="#team">Team</a>
            <OuterLink href="https://www.gofundme.com/f/support-project-pixel-orbital-student-team" class="button primary">
                Support the launch
                <IconExternalLink />
            </OuterLink>
        </nav>
    </header>

    <main id="top" class="content-shell">
        <section class="hero">
            <div class="hero-copy">
                <Text tag="div" tone="tertiary" class="eyebrow">PixelSat I</Text>
                <Text variant="display" class="hero-title">A CubeSat built by high schoolers on Earth.</Text>
                <Text variant="body" tone="secondary" class="hero-body">
                    Project Pixel Orbital is a fully student-led team at Stanford Online High School building PixelSat I, a 3U CubeSat targeting launch into sun-synchronous low Earth orbit in early 2027, from scratch, on an extremely limited budget.
                </Text>

                <div class="hero-actions">
                    <a href="#mission" class="button primary">
                        See what we're building
                        <IconArrowRight />
                    </a>
                    <OuterLink href="https://www.instagram.com/projectpixelorbital/" class="button">
                        Instagram
                        <IconExternalLink />
                    </OuterLink>
                    <OuterLink href="https://www.youtube.com/@projectpixelorbital2026" class="button">
                        YouTube
                        <IconExternalLink />
                    </OuterLink>
                </div>

                <div class="stat-row">
                    {#each stats as stat}
                        <div class="stat-pill">
                            <Text tag="div" class="stat-value">{stat.value}</Text>
                            <Text tag="div" tone="tertiary" class="stat-label">{stat.label}</Text>
                        </div>
                    {/each}
                </div>
            </div>

            <div class="hero-visual">
                <img src={render} alt="Transparent CAD render of PixelSat I" class="hero-render" />
            </div>
        </section>

        <section class="snapshot">
            <div class="section-heading compact">
                <Text variant="title">In brief</Text>
            </div>

            <div class="snapshot-grid">
                {#each snapshot as [label, value]}
                    <div class="snapshot-item">
                        <Text tag="div" tone="tertiary" class="snapshot-label">{label}</Text>
                        <Text tag="div" class="snapshot-value">{value}</Text>
                    </div>
                {/each}
            </div>
        </section>

        <section id="mission" class="section-block">
            <div class="section-heading">
                <Text variant="title">Mission</Text>

            <div class="simple-grid">
                {#each mission as item}
                    <article class="list-item">
                        <div>
                            <Text variant="heading">{item.title}</Text>
                            <Text variant="body" tone="secondary">{item.body}</Text>
                        </div>
                    </article>
                {/each}
            </div>
        </section>

        <section id="systems" class="section-block">
            <div class="section-heading">
                <Text variant="title">Technical overview</Text>
            </div>

            <div class="simple-grid systems-list">
                {#each systems as system}
                    <article class="list-item system-item">
                            <Text variant="heading">{system.title}</Text>
                        <Text variant="body" tone="secondary">{system.body}</Text>
                    </article>
                {/each}
            </div>
            <div class="links-row">
            <OuterLink href="https://www.gofundme.com/f/support-project-pixel-orbital-student-team" class="button">
                Help fund the hardware
                <IconExternalLink />
            </OuterLink>
            <OuterLink href="https://www.instagram.com/projectpixelorbital/" class="button">
                Follow the build
                <IconExternalLink />
            </OuterLink>
            </div>
        </section>


        <section id="team" class="section-block">
            <div class="section-heading split-heading">
                <div>
                    <Text variant="title">Team</Text>
                </div>
            </div>

            <div class="team-grid">
                {#each team as member}
                    {#if member.href}
                        <a class="team-entry" href={member.href} target="_blank" rel="noreferrer">
                            <div class="team-avatar placeholder">{member.initials}</div>
                            <div>
                                <Text variant="subheading">{member.name}</Text>
                                <Text variant="body" tone="secondary">{member.role}</Text>
                            </div>
                        </a>
                    {:else}
                        <article class="team-entry">
                            {#if member.image}
                                <img class="team-avatar" src={member.image} alt={member.name} />
                            {:else}
                                <div class="team-avatar placeholder">{member.initials}</div>
                            {/if}
                            <div>
                                <Text variant="subheading">{member.name}</Text>
                                <Text variant="body" tone="secondary">{member.role}</Text>
                            </div>
                        </article>
                    {/if}
                {/each}
            </div>
        </section>

        <section class="cta-band">
                <Text variant="title">Support us</Text>
            <Text variant="body" tone="secondary" class="hero-body">
                Launch costs are covered, but we're seeking funding for the actual hardware of the satellite. Our $10,000 budget is already measly compared to the millions available to many university teams, so every dollar helps.
            </Text>

            <div class="cta-actions">
                <OuterLink href="https://www.gofundme.com/f/support-project-pixel-orbital-student-team" class="button primary">
                    Donate on GoFundMe
                    <IconExternalLink />
                </OuterLink>
            </div>
        </section>
    </main>
</div>

<style>
    .page-shell {
        min-height: 100vh;
    }

    .topbar,
    .content-shell {
        width: min(980px, calc(100vw - 40px));
        margin: 0 auto;
    }

    .topbar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 18px;
        padding: 24px 0 10px;
        border-bottom: 1px solid var(--helium-elevated-15);
    }

    .brand {
        display: flex;
        align-items: center;
        gap: 12px;
        text-decoration: none;
    }

    .brand img {
        width: 42px;
        height: 42px;
        object-fit: contain;
    }

    .nav-links {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
        justify-content: flex-end;
    }

    .nav-links > a:not(.button) {
        color: var(--secondary);
        text-decoration: none;
        font-size: 14px;
        padding: 8px 10px;
    }

    .content-shell {
        display: flex;
        flex-direction: column;
        gap: 56px;
        padding: 28px 0 64px;
    }

    .hero {
        display: grid;
        grid-template-columns: minmax(0, 1.1fr) minmax(320px, 0.9fr);
        gap: 24px;
        align-items: center;
        padding: 10px 0 24px;
        border-bottom: 1px solid var(--helium-elevated-15);
    }

    .hero-copy {
        display: flex;
        flex-direction: column;
        gap: 18px;
    }

    .hero-actions,
    .cta-actions,
    .links-row {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
        align-items: center;
    }

    .stat-row {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
        margin-top: 4px;
    }

    .stat-pill {
        padding: 12px 0;
        border-top: 1px solid var(--helium-elevated-15);
    }

    .hero-visual {
        display: grid;
        place-items: center;
    }

    .hero-render {
        width: min(100%, 380px);
        height: auto;
        object-fit: contain;
    }

    .snapshot,
    .section-block,
    .cta-band {
        display: flex;
        flex-direction: column;
        gap: 18px;
    }

    .section-heading {
        display: flex;
        flex-direction: column;
        gap: 14px;
    }

    .section-heading.compact {
        gap: 10px;
    }

    .simple-grid,
    .team-grid {
        border-top: 1px solid var(--helium-elevated-15);
    }

    .snapshot-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 0 24px;
        border-top: 1px solid var(--helium-elevated-15);
    }

    .snapshot-item,
    .list-item,
    .team-entry {
        padding: 16px 0;
        border-bottom: 1px solid var(--helium-elevated-15);
    }

    .snapshot-item {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .simple-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0 24px;
    }

    .list-item {
        display: flex;
        gap: 18px;
    }

    .list-item :global(h3),
    .team-entry :global(h4) {
        margin-bottom: 8px;
    }

    .list-item :global(p),
    .team-entry :global(p) {
        font-size: 17px;
        line-height: 1.55;
    }

    .system-item {
        flex-direction: column;
        gap: 10px;
    }

    .split-heading {
        align-items: end;
        justify-content: space-between;
        flex-direction: row;
        gap: 20px;
    }

    .team-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 0 24px;
    }

    .team-entry {
        display: flex;
        flex-direction: column;
        gap: 14px;
        text-decoration: none;
    }

    .team-avatar {
        width: 100%;
        aspect-ratio: 1;
        object-fit: cover;
        object-position: center;
        background: #f2f2f2;
    }

    .team-avatar.placeholder {
        display: grid;
        place-items: center;
        color: var(--primary);
        font-size: 42px;
        font-weight: 500;
        border: 1px solid var(--helium-elevated-15);
    }

    .cta-band {
        padding-top: 8px;
        border-top: 1px solid var(--helium-elevated-15);
    }

    @media (max-width: 900px) {
        .hero,
        .split-heading {
            grid-template-columns: 1fr;
            flex-direction: column;
            align-items: stretch;
        }

        .team-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }
    }

    @media (max-width: 720px) {
        .topbar {
            flex-direction: column;
            align-items: stretch;
        }

        .nav-links {
            justify-content: flex-start;
        }

        .snapshot-grid,
        .simple-grid,
        .team-grid,
        .stat-row {
            grid-template-columns: 1fr;
        }

        .snapshot-grid,
        .simple-grid,
        .team-grid {
            display: block;
        }

        .list-item {
            flex-direction: column;
        }
    }
</style>
