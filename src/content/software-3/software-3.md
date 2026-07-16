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

We decided to use an STM32 as our main computer, since it has an extensive flight heritage in satellites such as FossaSat-2. 

## RTIC

RTIC functions by (ab)using the NVIC (Nested Vectored Interrupt Controller) on arm processors to have a lightweight strict priority-based scheduling system.

RTIC converts task priorities into interrupt priorities, so higher priority can "preempt" lower priority tasks. The ARM NVIC pushes a stack frame onto the CPU's stack when an interrupt is triggered, so state is preserved across interrupts. Likewise, when the higher priority task finishes, the lower priority task's state is restored from the stack frame.

Tasks can also be triggered by external interrupts, allowing for event-driven execution without polling.

By being async, tasks can easily suspend and resume execution, without blocking the CPU in spinloops.
This lets lower priority tasks run while higher priority tasks are waiting for I/O or other resources.
Tasks on the same priority level run in a round-robin fashion and cooperatetively share the CPU time.

For example:

```rust
#[task(priority = 6, local = [watchdog])]
async fn watchdog(ctx: watchdog::Context) {
    loop {
        ctx.local.watchdog.feed(); // Feeds a watchdog to prevent shutdown
        Mono::delay(1_u64.secs()).await; // Lets tasks of any priority go on
    }
}
```

This is a rather simple loop task that prevents the stm from shutting down by feeding the watchdog.

You might notice the `local = [watchdog]`, this indicates that a local context variable, `watchdog`, needs to be initialized
in the init function.

To indicate this, we have a local struct:
```rust
    #[local]
    pub struct LocalResources {
        // ...
        pub watchdog: IndependentWatchdog,
        // ...
    }
```

which we initialize in the `init` routine:

```rust
#[init]
pub fn init(
    mut ctx: init::Context,
) -> (SharedResources, LocalResources) {
    // ...
    let imu = ...;
    // ...
    (
        SharedResources {
            imu,
            mag,
            css,
            rtc,
            tle,
            rad,
            // ...
        },
        LocalResources {
            imu_int,
            mag_drdy,
            // ...
            transceiver_tx,
            transceiver_rx,
            watchdog,
            ramecc,
            // ...
        },
    )
}
```

## Synchronization and preventing deadlocks
