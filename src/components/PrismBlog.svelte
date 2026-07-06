<script lang="ts">
    import { IconExternalLink, OuterLink, Text } from "@imput/helium-prism";
    import logo from "../assets/images/ppologo.png?url";

    let { authors, title } = $props();
</script>

<div class="page-shell">
    <header class="topbar">
        <a class="brand" href="/" aria-label="Project Pixel Orbital home">
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
        <section class="header">
            <Text variant="display" class="hero-title">{title}</Text>
            <Text tag="div" tone="tertiary" class="eyebrow">by {authors}</Text>
        </section>
        <section class="content">
            <div class="prose">
                <slot />
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
        width: min(1040px, calc(100vw - 40px));
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
        justify-content: flex-end;
        flex-wrap: wrap;
        gap: 10px;
    }

    .nav-links > a:not(.button) {
        padding: 8px 10px;
        font-size: 14px;
        color: var(--secondary);
        text-decoration: none;
    }

    .content-shell {
        display: flex;
        flex-direction: column;
        padding: 32px 0 72px;
    }

    .header {
        display: flex;
        flex-direction: column;
        gap: 14px;
    }

    .eyebrow {
        letter-spacing: 0.08em;
        text-transform: uppercase;
    }

    .hero-title {
        max-width: 14ch;
        text-wrap: balance;
    }

    .content {
        width: 100%;
    }

    .prose {
        margin: 0 auto;
        color: var(--secondary);
        font-size: clamp(1rem, 0.98rem + 0.2vw, 1.075rem);
        line-height: 1.75;
    }

    .prose :global(*) {
        min-width: 0;
    }

    .prose :global(h1),
    .prose :global(h2),
    .prose :global(h3),
    .prose :global(h4),
    .prose :global(h5),
    .prose :global(h6) {
        margin: 2.5rem 0 0.9rem;
        color: var(--primary);
        line-height: 1.15;
        text-wrap: balance;
    }

    .prose :global(h1) {
        font-size: clamp(2.25rem, 2rem + 1vw, 3rem);
    }

    .prose :global(h2) {
        margin-top: 1rem;
        padding-top: 1.5rem;
        font-size: clamp(1.6rem, 1.45rem + 0.5vw, 2rem);
        border-top: 1px solid var(--helium-elevated-15);
    }

    .prose :global(h3) {
        font-size: clamp(1.3rem, 1.22rem + 0.35vw, 1.6rem);
    }

    .prose :global(h4),
    .prose :global(h5),
    .prose :global(h6) {
        font-size: 1.05rem;
    }

    .prose :global(p),
    .prose :global(ul),
    .prose :global(ol),
    .prose :global(blockquote),
    .prose :global(pre),
    .prose :global(table),
    .prose :global(figure) {
        margin: 1.1rem 0;
    }

    .prose :global(ul),
    .prose :global(ol) {
        padding-left: 1.4rem;
    }

    .prose :global(ul) {
        list-style: disc;
    }

    .prose :global(ol) {
        list-style: decimal;
    }

    .prose :global(li + li) {
        margin-top: 0.45rem;
    }

    .prose :global(strong) {
        color: var(--primary);
        font-weight: 600;
    }

    .prose :global(a) {
        color: var(--helium-blue);
        text-decoration: underline;
        text-decoration-thickness: 0.08em;
        text-underline-offset: 0.16em;
    }

    .prose :global(a:hover) {
        color: var(--helium-blue-hover);
    }

    .prose :global(blockquote) {
        padding: 0.2rem 0 0.2rem 1rem;
        border-left: 3px solid var(--helium-elevated-25, var(--helium-elevated-15));
        color: var(--primary);
    }

    .prose :global(hr) {
        margin: 2.5rem 0;
        border: 0;
        border-top: 1px solid var(--helium-elevated-15);
    }

    .prose :global(code) {
        padding: 0.15rem 0.4rem;
        border: 1px solid rgba(17, 17, 17, 0.08);
        border-radius: 0.45rem;
        background: rgba(17, 17, 17, 0.04);
        color: var(--primary);
        font-size: 0.92em;
    }

    .prose :global(pre) {
        overflow-x: auto;
        padding: 1rem 1.1rem;
        border: 1px solid rgba(17, 17, 17, 0.08);
        border-radius: 0.9rem;
        background: #111111;
        color: #f5f5f5;
    }

    .prose :global(pre code) {
        padding: 0;
        border: 0;
        border-radius: 0;
        background: transparent;
        color: inherit;
        font-size: 0.95rem;
    }

    .prose :global(img),
    .prose :global(video) {
        display: block;
        width: 100%;
        max-width: 100%;
        height: auto;
        margin: 1.5rem 0;
        border-radius: 1rem;
    }

    .prose :global(figcaption) {
        margin-top: 0.75rem;
        font-size: 0.95rem;
        color: var(--tertiary);
        text-align: center;
    }

    .prose :global(table) {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.98rem;
    }

    .prose :global(th),
    .prose :global(td) {
        padding: 0.8rem 0.9rem;
        border-bottom: 1px solid var(--helium-elevated-15);
        text-align: left;
        vertical-align: top;
    }

    .prose :global(th) {
        color: var(--primary);
        font-weight: 600;
    }

    .prose :global(sup) {
        font-size: 0.72em;
    }

    .prose :global(.footnotes) {
        margin-top: 3rem;
        padding-top: 1.5rem;
        border-top: 1px solid var(--helium-elevated-15);
        font-size: 0.95rem;
    }

    .prose :global(.footnotes p) {
        margin: 0.7rem 0;
    }

    @media (max-width: 720px) {
        .topbar {
            flex-direction: column;
            align-items: stretch;
        }

        .nav-links {
            justify-content: flex-start;
        }

        .content-shell {
            padding-bottom: 56px;
        }

        .prose {
            width: 100%;
        }
    }
</style>
