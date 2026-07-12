---
title: |
    PixelSat I Software Part 3: Attitude Determination and Control System
authors: Ashwin Naren, Vinayak Vikram, and Aadish Verma
---

**N.B. We've swapped the ordering of posts 2 and 3.**

Welcome to the third post in our series about the PixelSat I software stack. If you haven't read [Part 1](/software-1) on our comms system, we'd recommend starting there for context on the mission.

## Attitude Determination and Control System

Put simply, ADCS is the subsystem that answers two questions continuously throughout the mission: "which way is the satellite currently pointing, and how fast is it rotating?" (determination), and "what do we need to do to point it somewhere else, or stop it from tumbling?" (control).

Like comms, ADCS is a subsystem where the "correct" solution used on larger missions (star trackers, reaction wheels, etc.) is completely out of reach for our budget. So a lot of this post is about the tradeoffs we made to get a working attitude system out of cheap, noisy, and somewhat sparse sensors.

## Constraints

- We cannot use reaction wheels or control moment gyroscopes. On most actual satellites these are widely used, since they let you apply torque in any direction independent of your environment as well as simply generate much more torque. However due to the fact that they are a) expensive b) extremely mechanically complex (we're trying to keep moving parts off this satellite) and c) draw power we don't have to spare, we committed early to magnetorquers only.
- We cannot use a star tracker either. We do not have neither the (cost) budget to get one (they require extremely good optics) as well as the computing budget to process their data.
- Sensors need to be cheap, low power, and easy to interface with over standard buses (I2C, SPI) from our onboard computer.

Given those constraints, our sensor suite ended up being:

- **Coarse Sun Sensor**: six photodiodes, one on each face of the satellite (+X, -X, +Y, -Y, +Z, -Z). Individually crude, but together they let us reconstruct a body-frame sun direction whenever the sun is visible.
- **Magnetometer** (PNI RM3100-CB): gives us a body-frame measurement of Earth's magnetic field, which we compare against a reference field.
- **IMU gyroscope**: gives us angular velocity directly, and is the main workhorse for short-timescale attitude propagation.
- **IMU accelerometer**: present on the same chip as the gyro, but not currently fused into the estimator.

Our sole actuator is a set of three orthogonal magnetorquers, which produce a magnetic dipole that reacts against Earth's local magnetic field to produce torque. Unfortunately, this imposes a massive constraint on our control system; magnetorquer torque is always perpendicular to the local magnetic field vector, so at any given instant there is a whole axis of torque we simply cannot apply.

## Attitude Determination System

### Why an EKF

We have two very different kinds of sensor information to reconcile. The gyro gives us a relative, high-rate measurement of angular velocity. However, it drifts over time. The sun sensor and magnetometer, on the other hand, give us absolute vector references, but at lower rate and lower individual accuracy, and magnetometer readings are not taken while we are torquing.

An Extended Kalman Filter (EKF) is the standard tool for exactly this kind of problem; fusing a fast, drifting relative sensor with slower absolute references, weighted by how much you trust each one at any given moment. "Extended" just means we linearize the (inherently nonlinear) attitude dynamics around our current best estimate at every step, rather than assuming everything is linear like a textbook Kalman filter would.

More specifically, the current implementation is a multiplicative error-state EKF. What this means is that instead of tracking the full attitude as a linear filter state, we propagate the nominal attitude on its own using proper nonlinear quaternion kinematics, and let the Kalman filter only track a small, linearizable error on top of that nominal estimate. Every update cycle, that small error correction gets folded multiplicatively into the nominal quaternion, and the error state resets back near zero.

### Attitude representation

Internally we propagate attitude as a unit quaternion, since quaternions have no singularities and compose cleanly. However, since quaternions are 4-parameter and are not taken well by other subsystems, we represent attitude as MRPs (Modified Rodrigues Parameters).

Because MRPs have a singularity at a full 360° rotation, we map the MRPs into the shadow set, which is simply an alternate MRP representation of the same physical orientation that stays well-behaved exactly where the primary representation blows up. Our estimator always checks the magnitude of the current MRP vector and swaps to the shadow set whenever it would otherwise approach that singularity, so the reported attitude never becomes numerically unstable in flight.
