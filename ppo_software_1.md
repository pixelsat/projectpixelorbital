# PixelSat I Software Part 1: Comms System

## Outline

- Constraints
  - Large link budget
  - Very low cost
  - Relatively low power
  - small footprint
- UHF
- LoRa vs GMSK/GFSK
  - LoRa
  - GMSK/GFSK
  - Handling doppler shift (us being dumb with GPS)
- Ground stations
- Encryption & Regulation
- Quadratic Model & RSSI
- Framing
  - AX.25
  - CSP
  - HDLC
- Low cost blah blah blah
- Timeline
  - AX1000
  - Cormorant
  - Various SX-series transceivers considered
      - SX1272
      - SX1278
      - SX1268
      - SX1262
    - The pains of TCXO
  - EBYTE E22-400T30D (has TCXO, wraps SX1262)
    - `AT+UFREQ` pain
    - Power budget
    - Link budget
- Current comms framing etc
- comms serialization macros stuff

Welcome to the first post in a series about the PixelSat I software stack.

PixelSat I is a 3U cubesat designed entirely by students at Stanford OHS and will be launched NET March 2027.

# Constraints
When choosing a transceiver there were a few constraints that we were absolutely bound to.

Firstly, the transceiver could not be expensive. Ideally it was under $500 after discounts.

Secondly, we needed something with a large link budget. Due to the nature of our satellite, we cannot guarentee precise orientations.

Thirdly, we needed something with a relatively low power draw. Something around 8V with a maximum draw of 200-300mA would be at the higher end of what we could use.

Lastly, the transceiver physically survive a cubesat: it must be small, handle the radiation, and handle the temperature cycling.

# UHF

UHF is the ideal frequency for communications at this scale because of the low power
requirements, ease of manufacturing (which implies a lower cost), and decent bandwidth.

Compared to VHF, UHF is less interfered by the ionosphere and has a smaller antenna footprint. Additionally the bandwidth is far superior.

The S band and X band do not have cheap, readily available COTS transceivers,
and additionally the power draw is higher, to compensate for the signal loss.

# LoRa vs GMSK/GFSK

## LoRa

LoRa operates by transmitting each symbol as a frequency sweep (described as a "chirp"). Due to this, LoRa signals are very interference-resistant and can transmit over long ranges. However, due to the frequency sweep, the occupied bandwidth of a LoRa signal is quite large (which means the spectral efficiency is low). Of course, the baud rate of LoRa is far less than GMSK/GFSK.

## GMSK/GFSK

### FSK (frequency shift keying)
FSK simply switches the frequency of a carrier wave between a set of discrete frequencies. For example, in BFSK (binary FSK), we might have a specific frequency for 0's and another for 1's, and the receiver matches which frequency is present during each symbol period and decodes the bit.

### GFSK (Gaussian FSK)
GFSK simply applies a Gaussian filter to the input data before frequency modulation, smoothing transitions between symbols. This reduces out-of-band emissions and occupied bandwidth compared to plain FSK while maintaining the same basic modulation scheme. The resulting signal is more spectrally efficient and supports higher symbol rates in a given band.

### GMSK (Gaussian minimum shift keying)
GMSK is simply a special case of GFSK where during modulation the shift is minimized while still allowing different symbols to be easily recognized (relatively, it still requires a bit more processing than plain GFSK).

## Handling Doppler shift
**Doppler shift** is the apparent carrier frequency shift due to the velocity differential between the transmitter and the receiver. If the transmitter is moving towards the receiver, the received frequency appears higher than the transmitted frequency, and the converse applies too.

Since LoRa uses chirp spread spectrum, it is generally more tolerant of frequency offsets caused by Doppler shift than GMSK/GFSK, since the latter protocols rely on detecting the small frequency changes around the carrier wave. Therefore, GMSK/GFSK requires accurately knowing the position and velocity of the satellite to properly decode the signal.

Due to Doppler shift and our design constraints, we eventually settled on a pure-LoRa communications stack. 

# Timeline

We have considered an inordinate amount of transceivers throughout this project, before settling on the Ebyte E22-400T30D LoRa module in May.

### GomSpace AX100
The GomSpace AX100 is a UHF/VHF transceiver used in many CubeSat missions. It operates with the GMSK/GFSK protocols, supporting configurable data rates and forward error correction. We first considered this because of its extensive flight heritage and the prevalence of GMSK ground stations. However, after talking to GomSpace, we were unable get a quote below $10k for one transceiver, which forced us to our next option...

### Needronix Cormorant
The Cormorant is another UHF/VHF CubeSat-first transceiver that interfaces over the PC/104 bus. It promises low power consumption, has extensive flight heritage, and supports various framing protocols such as CSP. It also has internal bitflip correction and reset mechanisms as well as RSSI measurement and various other 

# Ground Network

UHF also has good ground network network support: the SatNOGS and TinyGS networks provide worldwide downlink connectivity for amateur satallites like ours.

Due to regulation, these networks are not readily able to provide uplink connectivity,
however specific operators might be able to provide it on a case-by-case basis.

SatNOGS supports VHF, UHF, and S-band and is more widely used. It additionally supports a variety of modulation schemes, including LoRa and GMSK.

Meanwhile TinyGS has a lower station cost and is more accessible to hobbyists, but only targets UHF LoRa.


# Current Comms Framing

At the moment we use a custom framing method. Due to the previously mentioned requirements from both regulators and the ground network, we encrypt uplink transmissions via AES-GCM and leave downlink transmissions unencrypted.

All packets start with a 8-byte magic string. The downlink magic is `PIXELSAT`. This is followed by a 4-byte CRC32 checksum of the rest of the packet.

The packet follows this header. If it is an uplink packet a 12-byte nonce is inserted after the header and before the data.

# Message Formatting

Due to the large number of messages that need to be transmitted, we use custom
derive macros to automatically generate serialization and deserialization code for our message types.

These macros are custom implemented, allowing to achieve the following goals:

1. No heap allocations
2. Maximum packing efficiency

For example, we pack boolean values as single bits to minimize the size of the packet.

The following code, for example, takes 1 byte:
```rust
#[derive(CommsSerialize, CommsDeserialize)]
pub struct Example {
    pub imu_up: bool,
    pub mag_up: bool,
    pub temp_up: bool,
    pub cam_up: bool,
    pub has_tle: bool,
}
```
