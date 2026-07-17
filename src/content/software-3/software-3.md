---
title: |
  PixelSat I Software Part 3: Onboard Computer
authors: Ashwin Naren, Vinayak Vikram, and Aadish Verma
date: 7/20/26
---

Welcome to the third post in our series about the PixelSat I software stack. If you haven't read [Part 1](/software-1) on our comms system, we'd recommend starting there for context on the mission. We also have a [Part 2](/software-2) about our attitude determination and control system.

## Onboard computer

The onboard computer (OBC) is the actual thing on the satellite that manages all of the electronic subsystems and handles the very important business logic. For CubeSat projects and in general in space, these are generally some variant of a microcontroller unit (MCU).

Following a theme established in our design processes for comms and ADCS, the industry standard for OBCs is exorbitantly expensive for our comparatively measly budget. For example, the [PyCubed](https://pycubed.org/), advertising radiation resistance and specialized for CubeSats, has to be fabbed (it cannot be bought off the shelf) which is not possible for us. Products offered by established manufacturers such as [GomSpace](https://gomspace.com/product/nanomind-a3200/) also turn out to be overpriced and often overpowered for our needs.

## Constraints

Ultimately, the OBC has two tasks: run our flight firmware, and connect to our various peripherals. Each of these entails several constraints. Firstly, the OBC, of course, has to have sufficient computing power to run our ADCS models and algorithms and various tasks. Secondly, it has to have peripherals for our various sensors, the magnetorquers, and the transceiver, such as UART, I2C, SPI, and generic GPIO pins. An implied third constraint is that the methods available to program it in Rust (including the HAL and concurrency framework) are available and idiomatic. 

Because of our unique environment and tasks, there are a few other nice-to-haves:
* Radiation resistance. Obviously, we can't use MCUs specialized for CubeSat tasks that are built with radiation in mind because of budget, but ideally our OBC is at least somewhat radiation-resistant.
* Real-time clock (RTC). We need to keep time on the OBC (the ADCS relies on having a somewhat accurate UNIX timestamp), so a real-time clock is ideal. After launch, when the satellite powers on, the ground will broadcast the current time via our comms system, which allows us to initialize the RTC and the corresponding ADCS parts to start. This isn't a deal breaker as dedicated RTC chips are available.
* Watchdog. We use a watchdog timer as part of our radiation resistance strategy. A watchdog is essentially a tiny chip which has the power to reset the OBC. The OBC has to send some kind of "heartbeat" -- say, one pulse on a digital pin every 5 seconds -- to the watchdog to avoid getting reset. If the heartbeat is dropped or the watchdog detects an atypical heartbeat, well, the OBC restarts. The thinking is that the heartbeat will only be corrupted if the OBC is in serious trouble -- for example, if radiation causes a bitflip, if a task starves the heartbeat task (which implies all other tasks are also being starved), or if the code latches up for another reason. Again, off-the-shelf dedicated watchdogs are available so this isn't a necessity.


## ESP32

Early in the project, the original software stack was a monolithic Python file launched on user login via systemd on a vanilla Raspberry Pi 5. This naturally had major issues; primarily, the use of a full-on Linux operating system added a massive degree of bloat and uncertainty to the system. Our Raspberry Pi has experienced issues with unexpectedly shutting down. RPis in general aren't the best w/r/t radiation resistance, and the idle power draw is much higher than we would prefer. When we finally got around to seriously working on flight software, the first thing we did was ditch this idea.

The first major OBC refactor occurred in February 2026, when we decided to use an ESP32 as our main computer. This also marked a shift towards bare-metal Rust: the ESP ran an Embassy async executor to handle everything, including our comms and ADCS routines. 

We originally kept the RPi around as a payload computer, linked over UART to the ESP32. Its sole task was to handle nonessential peripherals: capturing, compressing, and sending images, and transmitting experiment data from our planned microbiology protein crystallization experiment.


We ultimately had to cut the microbiology experiment for various reasons, and the camera module we finalized on turned out to handle JPEG compression on its end. This left basically no use for the Raspberry Pi, so we set out to remove it from the stack altogether. Our next plan was to use a dual-ESP32 architecture where `esp0` handled comms, ADCS, and scheduling, and `esp1` handled telemetry and image processing. We chose this over a single ESP32 so that we could devote an entire `esp0` core to ADCS and not have to worry at all about it being interrupted by some scheduler. However, this was still unnecessarily complicated.

## STM32

We finally decided to use an STM32, specifically, the STM32H753ZI, as our main computer, since it has an extensive flight heritage in satellites such as FOSSASAT-2. Furthermore, it has significantly more processing power, peripherals, and on-device amenities than the ESP32. For example, unlike the ESP32, it has an internal watchdog. It also has more RAM than the ESP32.

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

Since RTIC targets single-core exclusively and has hard priorities, using a wait-based `Mutex` for resource management would result in hangs when priorities are different.

RTIC mutexes, therefore, elevate a task's priority to the priority of the highest-prority task that shares the resource.
This prevents priority inversion by ensuring critical sections cannot be preempted by any other task using the resource.

When a resource is shared exclusively by tasks with the same priority, it can be considered lockless because
there will never be preemption of the resource.
