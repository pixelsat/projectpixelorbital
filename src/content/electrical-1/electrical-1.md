---
title: |
    PixelSat I Electrical Part 1: Electrical Power System
authors: Vinayak Vikram, Ashwin Naren
date: 7/27/2026
---

Welcome to the first post in a series about the PixelSat I electrical system.
In this series, we will explore both what we built and also how we arrived there.
If you are new to our mission, we highly recommend checking out our software blog series.

The electrical power system (EPS) of a satellite is akin to the cardiovascular system of a human.

It harvests energy from the panels and then distributes it to the battery and the various electrical components.



<!-- Something something if the eps fails it would be like cutting of bloodflow to organs
bro is on somethign^^ -->

## Buses
In some ways, we can view the overarching design of the EPS as a very broad optimization problem.
We began designing the system in earnest after finalizing our [STM32 microcontroller](/software-3) and settling on the [EByte E22-400T30D](/software-1) transceiver.
This meant that at the very least we had to have two rails at 5V and 3.3V.

The other main constraint is that we had to prepare for our hand-wound magnetorquers to draw upwards of 2A of current randomly; as such, it made sense to have a third, unregulated rail that drove the torquers.
The calculations are outlined in the [ADCS blog post](/software-2), but we are biased towards higher voltages on this rail.

From this, we settled on a relatively simple architecture:
```
6-8V source --- buck to 5V  --- LDO to 3.3V
     |              |               |
 torquers       transceiver        main
```
<!--
outline:

constraints
battery
    - fuel monitoring, charging
explanation of r, c, l
    - brief physics dhristimaxxing session
regulating for the transceiver
    - lt8610 wiring
    orz^
thank god our ldo is trivial
interference and decoupling
    - the 2000uF capacitor is larger than my gee gun
    - ashwinorz "servoorz" "mathorz" "csorz" "lcporz" "eeorz" "ui/uxorz" "osdevorz" "soydevorz" "trumpimpressionorz" "miriorz" "orz" "d0stalkingorz" narenorz and the capacitor saga /j
mpptorz
    - lt3652orz
    - schottky diodes and why theyre cool
-->

## Battery

With this all in mind, we were looking in the 6-8V range for a battery. We decided to go with a 3p2s LiPo battery (each cell being a 21700, a very common and reliable hobby battery), operating at a nominal voltage of 7.4V.

## MPPT
Maximum Power Point Tracking extracts maximum possible power from solar panels.

Solar panels generate electricity with a non-linear relationship between voltage and current, and how much power the panel produces depends on how stressed it is.
If we consider a grpah of this voltage-to-current relationship, it would look somewhat like this:
<!-- TODO: insert graph -->

Now consider the graph of power vs voltage. This can be obtained by multiplying our voltage-current graph by the voltage at each point to get something like the graph below:
<!-- TODO: insert graph -->

We can see that there is exactly one point where the panel delivers the greatest possible power, known as the Maximum Power Point (MPP).
Operating to either side of this peak leaves usable energy on the table.
If the load draws too little current, the panel voltage rises toward its open-circuit voltage while the current falls, resulting in low power output.
On the other hand, if the load draws too much current, the panel voltage collapses, and despite the increased current,
the total power again decreases.

The obvious question is: what determines where the panel operates on this curve, and how do we optimize for power?

The answer is simply the electrical load connected to it.
If a solar panel is connected directly to a battery, the battery effectively dictates the panel's operating voltage.
For example, a fully discharged 2S lithium-ion battery may sit at around 6 V, while a fully charged battery sits around 8.4 V.
If our solar panel's maximum power point is closer to 17–18 V, then directly connecting the panel forces it to operate far away from its optimal point,
potentially wasting a significant fraction of the available solar power.

To avoid this, we insert a regulator between the solar panel and the battery.
Unlike a direct connection, the regulator can present one voltage to the solar panel while simultaneously supplying a sink
at a completely different voltage to the battery.
Since an ideal converter conserves power (aside from efficiency losses), it can draw power from the panel at its maximum power point
while delivering that energy at the voltage required to safely charge the battery.

What we have just defined is a Maximum Power Point Tracker (MPPT) circuit.
Rather than allowing the battery to determine the panel voltage, the MPPT circuit continuously adjusts the internal regulator
so that the solar panel remains operating as close as possible to its maximum power point.
As sunlight intensity changes throughout our orbit or the satellite rotates, the available current changes,
but the MPPT continually adapts to ensure the panel is extracting nearly the maximum possible power.

In our case, we use the [LT3652](https://www.analog.com/media/en/technical-documentation/data-sheets/3652fe.pdf),
which implements a constant-voltage MPPT algorithm.
Instead of explicitly searching for the peak of the power curve, it regulates the panel voltage to a configurable setpoint,
which we choose to coincide with the panel's maximum power point under nominal operating conditions.
For our solar cells, the voltage at the maximum power point changes relatively little with irradiance (around 9.6V),
making this a simple and highly effective approach.
The resistor divider connected to the VIN_REG pin sets this target voltage, and the controller automatically adjusts the battery charging current
to keep the panel operating at that setpoint.
In addition, once the battery approaches its full charge voltage and the charge current drops below $1/10$th of the programmed maximum,
the LT3652 automatically terminates the charging cycle and enters a low-current standby mode to prevent overcharging.
