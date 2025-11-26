---
layout: page
title: "MoiréLens"
description: Visualizing Invisible Airflows with Commodity Cameras
img: assets/img/publication_preview/moirelens-logo.png
importance: 0
category: work
timeline: May 2025 - Nov 2025
labels: ["Sensing", "CV/ML"]
---

## Overview

MoiréLens is a practical Schlieren-like imaging system that brings refractive-index visualization into real-world environments. We embed high-frequency, human-imperceptible Moiré stimuli into wallpaper and use a low-cost RGB camera to convert tiny density changes in air into large Moiré phase shifts. An automatic calibration module keeps the effective fringe pattern stable under changing camera poses and lighting, and an end-to-end pipeline turns the raw Moiré videos into flow-like visualizations that can be consumed directly by lightweight ML models.


## Contributions

- Design a wallpaper-based Moiré stimulus that is invisible to humans but highly sensitive to airflows, heat plumes, and gas leaks when viewed through a commodity camera.

- Develop AutoMoiré, an automatic calibration loop that continuously adjusts stimulus frequency and phase to maintain high sensitivity under camera pose and illumination changes.

- Build a Moiré-to-Schlieren processing pipeline that extracts flow-like fields from raw videos and feeds them into compact 3D CNNs for downstream tasks.

- Demonstrate end-to-end applications using only video from a commodity camera, including meter-scale localization of low-pressure gas leaks and cooking automation tasks such as dry vs. moist heat classification and oil-temperature regression.

**Timeline:** May 2025 - Nov 2025

**Status.** Manuscript under double-blind review for a flagship ACM conference on mobile computing.  
