import math
import time
import numpy as np
import sounddevice as sd
import subprocess


# ============================================================
# NOISEWATCH V1.1
# ============================================================

SAMPLE_RATE = 44100
CHANNELS = 1

# This is dBFS, NOT calibrated dB SPL.
# Based on your test:
#
# Quiet       ≈ -48 dBFS
# Talking     ≈ -30 dBFS
# Loud music  ≈ -12 dBFS
#
LOUD_THRESHOLD_DB = -20

# Noise must stay above the threshold
# for this many seconds.
TRIGGER_DURATION = 10

# How frequently we measure.
ANALYSIS_INTERVAL = 1

# Minimum time between notifications.
COOLDOWN = 60


# ============================================================
# STATE
# ============================================================

loud_seconds = 0
last_alert_time = 0


# ============================================================
# MACOS NOTIFICATION
# ============================================================

def send_notification(db):

    message = (
        f"Ambient noise is very loud "
        f"({db:.1f} dBFS) for {TRIGGER_DURATION}+ seconds."
    )

    subprocess.run([
        "osascript",
        "-e",
        f'display notification "{message}" '
        f'with title "⚠️ NoiseWatch" '
        f'sound name "Glass"'
    ])


# ============================================================
# AUDIO MEASUREMENT
# ============================================================

def calculate_dbfs(audio):

    if audio.ndim > 1:
        audio = audio.mean(axis=1)

    rms = np.sqrt(np.mean(np.square(audio)))

    if rms < 1e-10:
        rms = 1e-10

    dbfs = 20 * math.log10(rms)

    return dbfs


# ============================================================
# MAIN
# ============================================================

def main():

    global loud_seconds
    global last_alert_time

    print("=" * 55)
    print("                 🔊 NOISEWATCH V1.1")
    print("=" * 55)
    print()
    print("Monitoring ambient sound through your Mac microphone.")
    print()
    print(f"Trigger threshold : {LOUD_THRESHOLD_DB} dBFS")
    print(f"Trigger duration  : {TRIGGER_DURATION} seconds")
    print(f"Alert cooldown    : {COOLDOWN} seconds")
    print()
    print("This is an UNCALIBRATED environmental noise monitor.")
    print("The readings are dBFS, not official dB SPL measurements.")
    print()
    print("Press CTRL+C to stop.")
    print()
    print("-" * 55)

    while True:

        try:

            # Record one second from microphone
            audio = sd.rec(
                int(SAMPLE_RATE * ANALYSIS_INTERVAL),
                samplerate=SAMPLE_RATE,
                channels=CHANNELS,
                dtype="float32"
            )

            sd.wait()

            db = calculate_dbfs(audio)

            # ------------------------------------------------
            # DISPLAY
            # ------------------------------------------------

            if db >= LOUD_THRESHOLD_DB:
                status = "🔴 LOUD"
            elif db >= LOUD_THRESHOLD_DB - 10:
                status = "🟡 ELEVATED"
            else:
                status = "🟢 NORMAL"

            print(
                f"\rCurrent: {db:6.1f} dBFS   "
                f"{status}   "
                f"Loud duration: {loud_seconds:02d}s",
                end="",
                flush=True
            )

            # ------------------------------------------------
            # LOUDNESS TIMER
            # ------------------------------------------------

            if db >= LOUD_THRESHOLD_DB:

                loud_seconds += ANALYSIS_INTERVAL

            else:

                loud_seconds = 0

            # ------------------------------------------------
            # ALERT
            # ------------------------------------------------

            current_time = time.time()

            if (
                loud_seconds >= TRIGGER_DURATION
                and current_time - last_alert_time >= COOLDOWN
            ):

                print()
                print()
                print("🚨🚨🚨 EXCESSIVE NOISE DETECTED 🚨🚨🚨")
                print(f"Level: {db:.1f} dBFS")
                print(f"Duration: {loud_seconds} seconds")
                print()

                send_notification(db)

                last_alert_time = current_time

                loud_seconds = 0

        except KeyboardInterrupt:

            print()
            print()
            print("=" * 55)
            print("NoiseWatch stopped.")
            print("=" * 55)
            break

        except Exception as e:

            print()
            print()
            print("ERROR:", e)
            break


if __name__ == "__main__":
    main()