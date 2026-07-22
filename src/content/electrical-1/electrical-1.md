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
<!-- TODO: ashwinorz add stuff i suck at theatre -->

## Constraints
In some ways, we can view the overarching design of the EPS as a very broad optimization problem.
We began designing the system in earnest after finalizing our [STM32 microcontroller](/software-3) and settling on the [EByte E22-400T30D](/software-1) transceiver.
This meant that at the very least we had to have two rails at 5V and 3.3V.

The other main constraint is that we had to prepare for our hand-wound magnetorquers to draw upwards of 2A of current randomly; as such, it made sense to have a third, unregulated rail that drove the torquers.
The calculations are outlined in the [ADCS blog post](/software-2), but we are biased towards higher voltages on this rail.

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

With this all in mind, we were looking in the 5-8V range for a battery. Though many excellent 5V batteries exist, we decided to go with a 3p2s 21700 battery, operating at a nominal voltage of 7.4V.

## MPPT
Maximum Power Point Tracking extracts maximum possible power from solar panels.

Solar panels generate electricity with a non-linear relationship between voltage and current, meaning there is an optimal place on the power curve where the panel outputs maximum wattage.

MPPT works by having a microprocessor dynamic adjust impedance to move to the optimal location on the power curve.

