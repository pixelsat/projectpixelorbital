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

Our sole actuator is a set of three orthogonal magnetorquers, which produce a magnetic dipole that reacts against Earth's local magnetic field to produce torque. Unfortunately, this imposes a massive constraint on our control system; magnetorquer torque is always perpendicular to the local magnetic field vector, so at any given instant there is a whole axis of torque we simply cannot apply.

## Attitude Determination System

### Why an EKF

We have two very different kinds of sensor information to reconcile. The gyro gives us a relative, high-rate measurement of angular velocity. However, it drifts over time. The sun sensor and magnetometer, on the other hand, give us absolute vector references, but at lower rate and lower individual accuracy, and magnetometer readings are not taken while we are torquing.

An Extended Kalman Filter (EKF) is the standard tool for exactly this kind of problem; fusing a fast, drifting relative sensor with slower absolute references, weighted by how much you trust each one at any given moment. "Extended" just means we linearize the (inherently nonlinear) attitude dynamics around our current best estimate at every step, rather than assuming everything is linear like a textbook Kalman filter would.

More specifically, the current implementation is a multiplicative error-state EKF. What this means is that instead of tracking the full attitude as a linear filter state, we propagate the nominal attitude on its own using proper nonlinear quaternion kinematics, and let the Kalman filter only track a small, linearizable error on top of that nominal estimate. Every update cycle, that small error correction gets folded multiplicatively into the nominal quaternion, and the error state resets back near zero.

### Attitude representation

Internally we propagate attitude as a unit quaternion, since quaternions have no singularities and compose cleanly. However, since quaternions are 4-parameter and are not taken well by other subsystems, we represent attitude as MRPs (Modified Rodrigues Parameters).

Because MRPs have a singularity at a full 360° rotation, we map the MRPs into the shadow set, which is simply an alternate MRP representation of the same physical orientation that stays well-behaved exactly where the primary representation blows up. Our estimator always checks the magnitude of the current MRP vector and swaps to the shadow set whenever it would otherwise approach that singularity, so the reported attitude never becomes numerically unstable in flight.

### Position propagation

Since we operate in Low-Earth Orbit with non-negligible drag, we cannot use simple Keplerian propagation. We use the sgp4 propagation model with b-star modelled atmospheric drag to propagate our position from a tle. We are quite proud of the fact that we have written the first complete B\*-modelling sgp4 implementation in Rust.



## Attitude Control System

### Overview
The attitude controller simply takes in the estimated attitude and the angular velocity coming out of the EKF, as well as a specific mode and profile to execute. We have 3 attitude control system modes: omega kill, fixed attitude, and ground point tracking. The controller then outputs a commanded body torque. As noted earlier, this torque often cannot be executed perfectly since we can only torque around a vector orthogonal to the local magnetic field line. 

<!-- https://www.sciencedirect.com/science/article/pii/S1474667017589156 -->

#### Omega kill

This is the simplest mode, where the controller simply stops the satellite from rotating.

This is very useful during detumble: at this time the satellite does not know anything about the current time or its TLE, so it's unable to use the sun sensors or magnetometer, which are the two absolute sensors available. As such it relies solely on the gyro measurement to cancel the satellite's angular velocity.

#### Fixed attitude

Most of the time we want to be pointing the satallite directly down at the earth, so the antenna has the widest coverage. This allows us to just point straight at the earth. We use a PID controller to generate our commanded torque here.

#### Ground point tracking

The last case is when we want to maximize link quality by pointing straight at a ground station, just to eek out the maximum gain. This is quite similar to the fixed attitude mode, in that a PID is still used, we just have a variable target angle that is calculated based on the satallites position.


### PID

We use a PID controller to generate our commanded torque profile. The controller simply outputs a weighted sum of the **P**roportional, **I**ntegral, and **D**erivative terms. More specifically:
- **Proportional**: the proportional term takes the attitude error
- **Integral**: the integral term accumulates the attitude error over time
- **Derivative**: the derivative term takes in the angular velocity error (to provide damping)

We clamp the integral term to prevent windup; without this if a large error appears the integral term will accumulate to gigantic proportions and would overshoot badly.

# DELETE THIS
GPT review: 
The structure is already good. What makes it read like engineering notes rather than a technical blog is mostly tone. Right now you're explaining what each component is, but readers will be much more engaged if you explain why you made each decision and what engineering problems it solves.

Some specific suggestions:

Replace textbook explanations ("The proportional term...") with mission-specific reasoning.
Add transitions between sections so it feels like a narrative rather than documentation.
Be more precise in a few places ("MRPs are not taken well by other subsystems" is vague).
Avoid apologetic wording ("cheap, noisy") and instead frame them as engineering constraints.
Whenever you introduce a concept, motivate it before defining it.
