---
title: |
  PixelSat I Software Part 3: Onboard Computer
authors: Ashwin Naren, Vinayak Vikram, and Aadish Verma
---

## Previous Dumb Ideas

Before we joined the project, the previous software stack was a monolithic python file launched on user login via systemd on a vanilla Raspberry Pi 5.
This naturally had ... major issues ... so the first thing we did was scrap this.

## ESP32

The first major OBC refactor occurred in Feburary 2026, when we decided to use an ESP32 as our main computer.

This also marked a shift towards bare-metal rust.
The ESP ran an Embassy async executor to handle everything, including our comms and ADCS routines.

We originally kept the raspi around as a payload computer, linked over UART to the ESP32 solely for sending images and microbio experiment data.
After we cut the microbio experiment and found a camera that natively supported the JPEG codec, we eventually cut the raspi altogether.
To handle all the tasks, we were planning on using a dual-esp architecture where esp0 handled comms, ADCS, and scheduling, and esp1 handled telemetry and image processing.

## STM32

We finally decided to use an STM32 as our main computer, since it has an extensive flight heritage in satellites such as FOSSASAT-2. Furthermore, it has significantly more processing power, peripherals, and on-device amenities than the ESP32.

### RTIC

RTIC is a Rust concurrency framework designed for embedded environments. It essentially maps tasks to ISRs (interrupt handlers). Task priorities are directly converted into interrupt priorities. This creates a semi-preemptive scheduling system where higher priority tasks, because of the underlying interrupt model, are able to preempt a running lower priority task. On ARM Cortex-M-based processors including our STM32, RTIC functions by (ab)using the NVIC (Nested Vectored Interrupt Controller) to have a lightweight strict priority-based scheduling system.

RTIC has two types of tasks: "hardware tasks" are triggered by peripheral-bound IRQs (interrupts), while "software tasks" are spawned by pending an otherwise-unused "dispatch" IRQ.

RTIC's biggest advantage is that we can still use Rust's powerful async model, idiomatically suspending and resuming execution, without blocking the CPU in spinloops. This lets lower priority tasks run while higher priority tasks are waiting for I/O or other resources. Tasks on the same priority level run in a round-robin fashion and cooperatively share the CPU time.

Here's the task we use to feed the internal watchdog (which is an on-chip timer which resets the STM32 if we stop feeding it a heartbeat):
```rust
#[task(priority = 6, local = [watchdog])]
async fn watchdog(ctx: watchdog::Context) {
    loop {
        ctx.local.watchdog.feed(); // Feeds a watchdog to prevent shutdown
        Mono::delay(1_u64.secs()).await; // Lets tasks of any priority go on
    }
}
```
You might notice the `local = [watchdog]`; this indicates that a local resource, `watchdog`, needs to be initialized
in the init function. Local resources are only accessible to one task, enforced by RTIC's context structure; there are also shared resources, which can be accessed by several tasks. To avoid data races and deadlocks, RTIC uses a mutex-like locking pattern for tasks to borrow shared resources. For example, here's the task we use to update the statistics for our radiation sensor: 
```rs
#[task(priority = 2, shared = [rad])]
async fn rad_task(mut ctx: rad_task::Context) {
    loop {
        Mono::delay(300.secs()).await;
        ctx.shared.rad.lock(|r| {
            r.update();
        })
    }
}
```
Similarly here, `shared = [rad]` indicates that a shared resource `rad` needs to be provided by our init function.

To indicate the resources we use, we have a struct for each type of resource:
```rs
#[shared]
pub struct SharedResources {
    // ...
    pub rad: Rad,
    // ...
}
#[local]
pub struct LocalResources {
    // ...
    pub watchdog: IndependentWatchdog,
    // ...
}
```

which we initialize in the `init` routine:

```rs
#[init]
pub fn init(
    mut ctx: init::Context,
) -> (SharedResources, LocalResources) {
    // ...
    
    let rad = Rad::new();
    // ...
    let mut watchdog = IndependentWatchdog::new(ctx.device.IWDG);
    watchdog.start(10.secs());

    info!("Watchdog initialized");

    (
        crate::app::SharedResources {
            // ...
            rad,
            // ...
        },
        crate::app::LocalResources {
            // ...
            watchdog,
            // ...
        },
    )
}
```

## Synchronization and preventing deadlocks
