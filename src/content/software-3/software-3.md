---
title: |
  PixelSat I Software Part 3: Onboard Computer
authors: Ashwin Naren, Vinayak Vikram, and Aadish Verma
date: 7/20/2026
---

Welcome to the third post in our series about the PixelSat I software stack.
[Part 1](/software-1) covered communications, and [Part 2](/software-2) covered attitude determination and control.
This post is about the microcontroller tying both together, and the software running on it.

## Onboard computer

Every input and output eventually passes through the onboard computer (OBC).
It runs the flight firmware and coordinates the satellite's electronic subsystems.
On a CubeSat, that usually means a low-power microcontroller that is hardened for space use.

Following a theme established by our comms and ADCS designs, the standard space-qualified answer is far outside our budget.
Open designs such as [PyCubed](https://pycubed.org/) would still require us to fabricate and qualify a board, while established products such as the [GomSpace NanoMind](https://gomspace.com/product/nanomind-a3200/) are expensive and more capable than our mission needs.
We instead looked for a commercial microcontroller with the right peripherals, enough performance, and useful resilience features already on the chip.

## Constraints

Ultimately, the OBC has two tasks: run our flight firmware and talk to everything around it.
It needs enough computational power for orbit propagation and the ADCS logic,
plus handling interrupts (at a high frequency) and periodic tasks.
Just as importantly, it needs a mature Rust hardware abstraction layer and a concurrency model we can reason about.

A few less obvious requirements follow from the environment:

- Fault tolerance: Hardware memory/flash protection and proper fault and error handling can stop some faults from becoming fatal.
- Real-time clock: ADCS needs UTC to propagate the orbit and calculate reference vectors. Ground control sets the clock after launch, and the RTC maintains it across resets.
- Watchdog: A watchdog is a timer the firmware must continually feed. If execution hangs, higher-priority work starves the feeder, or a fault places the processor somewhere unexpected, the internal watchdog expires and triggers a reset. An internal independent watchdog is especially useful because it runs separately from the main MCU while being well coupled to the reset pin.

## ESP32

Early in the project, our "flight software" was a monolithic Python file launched by `systemd` on login to a Raspberry Pi 5. 
It was a poor spacecraft architecture.

Linux brings in power draw, scheduling, unexpected tasks, and many other issues.
Additionally, we had already seen the Pi shut down unexpectedly on the bench, so putting it beyond physical reach would not improve matters.

Our first major redesign came in February 2026, when we moved the main flight software to bare-metal Rust on a classic dual-core ESP32.
An Embassy async executor ran comms, ADCS, and the rest of the spacecraft tasks.
We kept the Pi as a payload computer over UART, responsible only for image processing and data from a planned protein-crystallization experiment.

Then the experiment was cut, and we found a camera that could encode JPEGs itself.
In doing so we put the RPI out of a job.
We briefly designed a dual-ESP32 system to replace the RPI, with one processor handling comms and ADCS while the other handled images and telemetry,
but the boundary created more failure modes and complication than it removed.

For example, handling esp1 (the camera ESP) failures with timeouts and choosing whe to reset it was an unneeded complication.

## STM32

We finally consolidated the satellite around an [STM32H753](https://www.st.com/en/microcontrollers-microprocessors/stm32h753zi.html), a 32-bit ARM Cortex-M7.
The chip can run at up to 480 MHz; however our firmware uses a 300 MHz system clock and a 150 MHz HCLK to reduce heat generation and power consumption.
It gives us 1 MB of SRAM, 2 MB of internal flash, tons of GPIO pins, a RTC, an independent watchdog, and a hardware memory ECC module.

That headroom let one MCU replace the Pi and both proposed ESP32s.

It also yielded some nice quality of life improvements:

- RAM and Flash ECC: No manual ECC implementations
- Built in watchdog: No external watchdog needed, yet another part cut out.
- More built in flash: No need for external flash
- Better tooling support: The classic ESP32 runs on XTENSA, an architecture from Cadence. Rust does not natively support it, so switching to a more supported architecture was a relief.

### RTIC

A fast processor is not very useful if multitasking is inefficient.
We use [RTIC](https://rtic.rs/), a Rust concurrency framework built around hardware interrupts.
Tasks have fixed priorities which map directly onto interrupt priorities.
When two tasks are ready, the higher-priority one always takes precidence; tasks of the same priority are round-robin scheduled.
On ARM Cortex-M, RTIC turns the [NVIC (Nested Vector Interrupt Controller)](https://developer.arm.com/documentation/100166/0001/Nested-Vectored-Interrupt-Controller), the chip's interrupt controller, into a compact priority-based scheduler.

When higher priority interrupts occur, the NVIC pushes a stack frame to handle them, once completed, the execution returns back to the original context.

Additionally, the NVIC handles pending interrupts.

RTIC also supports async Rust. A task waiting for a timer, command, or sensor can suspend at an `.await` instead of wasting the CPU in a spin loop. Lower-priority work can then proceed, while tasks at the same priority cooperate at those suspension points. We get predictable preemption without carrying a full RTOS.

Here's the task we use to feed the internal watchdog (which is an on-chip timer which resets the STM32 if we stop feeding it a heartbeat):

```rust
#[task(priority = 6, local = [watchdog])]
async fn watchdog(ctx: watchdog::Context) {
    loop {
        ctx.local.watchdog.feed();
        Mono::delay(1_u64.secs()).await;
    }
}
```

The `local = [watchdog]` declaration matters because
RTIC gives that resource exclusively to this task, and the generated context makes it impossible for another task to borrow it.
Resources needed by several tasks are declared `shared` and accessed through short critical sections.
For example, this task periodically updates the accumulated radiation statistics:

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

The actual radiation events arrive asynchronously.
A [rising edge interrupt](https://en.wikipedia.org/wiki/Interrupt#Edge-triggered) from the sensor triggers a GPIO interrupt and increments a counter via a task; `rad_task` later uses that counter as part of its statistics:

```rs
#[task(binds = EXTI15_10, priority = 7, shared = [/* ... */], local = [rad_out, /* ... */])]
fn mag_and_rad_interrupt(mut ctx: mag_and_rad_interrupt::Context) {
    if ctx.local.rad_out.check_interrupt() {
        ctx.local.rad_out.clear_interrupt_pending_bit();
        click();
    }

    // ...
}
```

`binds = EXTI15_10` makes this a hardware task: the processor invokes it directly for that interrupt line.
Several GPIOs share the same line, so the handler checks which pin is actually pending.
In the omitted half, the magnetometer's data-ready pin is handled the same way and its sample wakes the ADCS task.

This is an unfortunate RTIC limitation, but it has more to do with massive number of peripherals on the STM32.

Software tasks such as `watchdog` and `rad_task` have no natural hardware interrupt.
RTIC dispatches them using interrupt lines we deliberately leave otherwise unused:

```rs
#[rtic::app(
    device = stm32h7xx_hal::stm32,
    peripherals = true,
    dispatchers = [EXTI0, EXTI1, EXTI2, EXTI3, EXTI4],
)]
mod app {
    // ...
}
```

The complete set of resources is declared centrally:

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
    pub rad_out: Pin<'D', 15, Input>,
    // ...
}
```

and constructed once in `init`:

```rs
#[init]
pub fn init(
    mut ctx: init::Context,
) -> (SharedResources, LocalResources) {
    // ...

    // rad sensor
    let mut rad_out = gpiod.pd15.into_pull_down_input();
    rad_out.make_interrupt_source(&mut ctx.device.SYSCFG);
    rad_out.trigger_on_edge(&mut ctx.device.EXTI, Edge::Rising);
    rad_out.enable_interrupt(&mut ctx.device.EXTI);
    rad_out.clear_interrupt_pending_bit();

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
            rad_out,
            // ...
        },
    )
}
```

## Synchronization without waiting

A conventional mutex is not viable for a preemptive, single-core system.
If a high-priority task interrupts a low-priority task holding a lock and then waits for that lock,
the low-priority task can never resume to release it.

RTIC avoids the problem with priority ceilings.
Each shared resource gets the priority of the highest-priority task that can access it.
While a task locks that resource, RTIC temporarily raises the task to the ceiling, so no competing task can preempt it.
Unrelated work above the ceiling can still run; interrupts do not need to be disabled all together.

This lets critical sections occur while high priority tasks still run.

Likewise, due to the use of critical sections, there is no sleeping lock or wait to acquire a resource.
The tradeoff is that lock closures must be short, and we never `.await` inside one.
Rust's borrow checker and RTIC's generated contexts enforce the rest.

## Embedded application

The firmware is `no_std` and `no_alloc`.
Buffers, packets, command queues, and torque profiles all have fixed capacities known at compile time.
This is occasionally less convenient than a `Vec`, but allocation provides a host of problems, as well as extra code.

The running system is a hierarchy of small jobs:

- **Priority 9:** RAM ECC faults
- **Priority 8:** incoming radio bytes
- **Priority 7:** IMU and magnetometer data-ready interrupts
- **Priority 6:** watchdog feeding and coarse sun sensor sampling
- **Priority 5:** attitude estimation and control
- **Priority 3:** commands, downlinks, heartbeats, and flash logging
- **Priority 2:** sensor recovery and radiation statistics
- **Priority 1:** the scheduled reset
- **Priority 0:** idle, where the core sleeps with `wfi` until an interrupt arrives

The tasks communicate through fixed-capacity async channels and signals.

## Storage without a disk

We use the STM32's second 1 MB flash bank as a tiny, purpose-built data store.
Its eight sectors are divided between one captured image, a two-sector circular log, a reserved sector, and the current TLE.
Each region is bounded by its own API, so image code cannot accidentally erase the program or the orbit data.

The camera already produces JPEG data.
During capture, firmware streams it to a 128 KiB buffer in AXI SRAM, and then writes it to flash in aligned chunks, and calculates a CRC as it goes.
Metadata is written last.
If power disappears halfway through a capture, the half-written bytes are never mistaken for a valid image.

The ground station later requests various chunks of the image.

Logs follow the same philosophy. `defmt` compresses each log frame, a fixed queue decouples logging from flash writes, and two sectors form a ring that overwrites the oldest data when full.
Ground control reads the stream with cursors, so useful history survives resets without requiring anything resembling a general-purpose filesystem.

Even if we wanted one, a general-purpose filesystem would not be possible on the STM32, because it is only possible to erase one (128 kb) sector at a time; no smaller section can be independently erased.

## Designing for recovery and failure management

The STM32 is not radiation-hardened, but it provided useful tools for fault tolerance.

The independent watchdog has a ten-second timeout and is fed once per second by a high-priority task.
We also deliberately reset the processor once an hour, limiting how long a corrupted state can last.
Additionally, broken IMU and magnetometer drivers are reinitialized by a recovery task rather than being left abandoned after a bus error.

RAM ECC gets the highest-priority interrupt in the system.
A correctable single-bit fault is repaired by writing the corrected word back; an uncorrectable double-bit fault causes an immediate reset.

For panic handling, interrupts are disabled, the panic message is copied into backup SRAM, queued logs are flushed to flash if the flash controller is available for use, and the chip then finally resets.
On the next boot, the panic record is recovered into the persistent log before normal operation resumes.

## Conclusion

Our OBC design became simpler each time we redesigned.

That final system still performs almost equivalent functionality to the original and yet is vastly more efficient.
