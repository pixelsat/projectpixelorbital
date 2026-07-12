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
- **Gyroscope**: gives us angular velocity directly, and is the main sensor for short-timescale attitude propagation.

Our sole actuator is a set of three orthogonal magnetorquers, which produce a magnetic dipole that reacts against Earth's local magnetic field to produce torque. Due to this: magnetorquers come with one major drawback: they cannot generate arbitrary torques. A magnetorquer produces a magnetic dipole $m$, which interacts with Earth's magnetic field $B$ according to $\tau=m \times B$.

Since the torque is always the cross product of these vectors, it is necessarily perpendicular to the local magnetic field. At any instant there is therefore one direction in which the spacecraft simply cannot produce torque.

Additionally due to only having 3 magnetorquers the strength of the produced magnetic dipole varies with the direction of the torque with respect to the spacecraft's body frame.

Our ACS system has to pick the closest possible dipole direction to the desired torque direction. TODO(yappy): explain more. yeah yeah i will after reading that paper
gotta explain sgp4 and torquers and photodiodes first

## Attitude Determination System

### Why an EKF

We have two very different kinds of sensor information to reconcile.

The gyro gives us a relative, high-rate measurement of angular velocity. However, it drifts over time, and can't give us a stable reference: it gives us velocity, not position.

The sun sensor and magnetometer, on the other hand, give us absolute vector references, but at a lower rate and lower individual accuracy. For example magnetometer readings are not taken while we are applying torque from the magnetorquers, as that heavily affects the readings. Instead, we have to temporarily pause the magnetotorquers every 500ms to take a reading. On the other hand, while the coarse sun sensor is not affected by this, it remains far less accurate than either the magnetometer or the IMU.

The EKF combines these complementary measurements. An EKF allows you to fuse a fast, drifting relative sensor with slower absolute references, weighted by how much you trust each one at any given moment. "Extended" just means we linearize the (inherently nonlinear) attitude dynamics around our current best estimate at every step, rather than assuming everything is linear like a textbook Kalman filter would.

More specifically, the current implementation is a multiplicative error-state EKF. What this means is that instead of tracking the full attitude as a linear filter state, we propagate the nominal attitude on its own using proper nonlinear quaternion kinematics, and let the Kalman filter only track a small, linearizable error on top of that nominal estimate. Every update cycle, that small error correction gets folded multiplicatively into the nominal quaternion, and the error state resets back near zero.

### Attitude representation

Internally, the estimator propagates attitude as a unit quaternion.
Quaternions avoid singularities, compose efficiently, and are the standard representation for spacecraft dynamics. 

Other software components, however, work more naturally with a minimal three-parameter representation.
For those interfaces we convert the output quaternion into Modified Rodrigues Parameters (MRPs).

Because MRPs have a singularity at a full 360° rotation, we map the MRPs into the shadow set, which is simply an alternate MRP representation of the same physical orientation that stays well-behaved exactly where the primary representation blows up.
Our estimator always checks the magnitude of the current MRP vector and swaps to the shadow set whenever it would otherwise approach that singularity, so the reported attitude never becomes numerically unstable in flight.

TODO: Example

### Position propagation

The project was full of dhristimaxxers who believed that Keplerian propagation was the best way to go about deriving our instantaneous position from a TLE.
Unfortunately, it is not that simple. Earth is not a simple point mass (which a perfect sphere models...), its gravitational field has extra terms (the zonal harmonics $J_2$, $J_3$, $J_4$) that steadile rotate our orbital plane and argument of perigee. On top of that, our orbit is low enough that there is enough atmosphere left that the drag measurably shrinks our orbit even over a few days/weeks.

The SGP4 (Simplified General Pertubations 4) model solves all these problems compactly by folding both gravitational pertubations and a drag model into a closed-form propagator (no need to numerically solve ODE's, for example...).

Our implementation of the model follows [Vallado's excellent description of SGP4](https://celestrak.org/publications/AIAA/2006-6753/)

## Attitude Control System

### Overview
The attitude controller simply takes in the estimated attitude and the angular velocity coming out of the EKF,
as well as a specific mode and profile to execute.

We have 3 attitude control system modes: omega kill, fixed attitude, and ground point tracking.
The controller then outputs a commanded body torque.
As noted earlier, this torque often cannot be executed perfectly since we can only torque around a vector orthogonal to the local magnetic field line.


<!-- https://www.sciencedirect.com/science/article/pii/S1474667017589156 -->

#### Omega kill

This is the simplest mode, where the controller simply stops the satellite from rotating.

This is very useful during right after launch: at this time the satellite is rapidly rotating and does not know anything about the current time or its TLE,
so it's unable to use the sun sensors or magnetometer, which are the two absolute sensors available.
As such it relies solely on the gyro measurement to cancel the satellite's angular velocity.

#### Fixed attitude

During nominal operations, PixelSat maintains a nadir-pointing attitude, keeping its antenna directed toward Earth.
This maximizes communication performance over the majority of each orbit while also providing a consistent reference frame for the rest of the spacecraft.

Additionally we can adjust this attitude as needed to take pictures.

We use a PID controller to generate our commanded torque here.

#### Ground point tracking

When communicating with one of our ground stations, we can do even better than simply pointing.

Rather than pointing toward Earth's center, the controller computes the line-of-sight vector to the selected ground station from the spacecraft's current orbit estimate.
The same feedback controller is then used, but with this continuously changing reference attitude.

This allows the antenna's main lobe to remain aligned with the receiving station throughout the pass, improving the available link margin.

### PID

We use a PID controller to generate our commanded torque profile. The controller simply outputs a weighted sum of the **P**roportional, **I**ntegral, and **D**erivative terms. More specifically:
- **Proportional**: the proportional term takes the attitude error
- **Integral**: the integral term accumulates the attitude error over time
- **Derivative**: the derivative term takes in the angular velocity error (to provide damping)

We clamp the integral term to prevent windup; without this if a large error appears the integral term will accumulate to gigantic proportions and would overshoot badly.
