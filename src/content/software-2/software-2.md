---
title: |
    PixelSat I Software Part 2: Onboard Computer
authors: Ashwin Naren, Vinayak Vikram, and Aadish Verma
---

**N.B. We've swapped the ordering of posts 2 and 3.**

## Previous Dumb Ideas
Before we joined the project, the previous software stack was a monolithic python file launched on user login via systemd on a vanilla Raspberry Pi 5 (the 8gb ram model, fwiw !!). I don't believe I need to explain why this was idiotic, not if the reader has any degree of intelligence.

## ESP32
The first major OBC refactor occured in Feburary 2026, when we decided to use an ESP32 as our main computer. We originally kept the raspi around as a payload computer, linked over UART to the ESP32 solely for sending images and microbio experiment data (yet another thing we cut). The ESP ran an Embassy async executor to handle everything, including our comms and ADCS routines.

After we cut the microbio experiment and found a camera that natively supported the JPEG codec, we eventually cut the raspi altogether. To handle all the tasks, we were planning on using a dual-esp architecture where esp0 handled comms, ADCS, and scheduling, and esp1 handled telemetry and image processing. 
  
## STM32
We decided to use an STM32 as our main computer, since it has an extensive flight heritage in satellites such as FossaSat-2. 

## RTIC

RTIC functions by (ab)using the NVIC (Nested Vectored Interrupt Controller) on arm processors to have a lightweight strict priority-based scheduling system.

RTIC converts task priorities into interrupt priorities, so higher priority can "preempt" lower priority tasks. The ARM NVIC pushes a stack frame onto the CPU's stack when an interrupt is triggered, so state is preserved across interrupts. Likewise, when the higher priority task finishes, the lower priority task's state is restored from the stack frame.

Tasks can also be triggered by external interrupts, allowing for event-driven execution without polling.

By being async, tasks can easily suspend and resume execution, without blocking the CPU in spinloops. This lets lower priority tasks run while higher priority tasks are waiting for I/O or other resources. Tasks on the same priority level run in a round-robin fashion and cooperatetively share the CPU time.

## Synchronization and preventing deadlocks
