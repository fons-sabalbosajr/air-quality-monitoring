# EMBR3 Air Quality Monitoring System
## Overview — General Audience

---

## Background

The **EMBR3 Air Quality Monitoring System** is a public-facing digital platform developed for the **Environmental Management Bureau – Region 3 (EMB Region 3)**, the Philippine government agency responsible for environmental protection in **Central Luzon**.

Central Luzon is one of the most populated and industrialized regions in the Philippines, encompassing the provinces of Aurora, Bataan, Bulacan, Nueva Ecija, Pampanga, Tarlac, and Zambales. Rapid urban and industrial growth in the region has made continuous monitoring of air quality a critical public health concern.

EMB Region 3 operates **Continuous Ambient Air Quality Monitoring Stations (AQMS)** — automated devices placed at strategic locations around the region that measure pollutant concentrations in the air around the clock. This system provides a digital window into those readings, making the data accessible and understandable for everyone — from ordinary citizens to local government officials and health professionals.

The platform uses the **Philippine National Ambient Air Quality Guideline Values (NAAQGV)**, set by the Department of Environment and Natural Resources (DENR), as the standard for interpreting pollutant levels and producing **Air Quality Index (AQI)** values.

---

## Features

The system provides the following main features:

- **Live Air Quality Dashboard**
  A real-time display of the current AQI reading for each monitoring station, updated continuously throughout the day.

- **Kiosk Mode**
  A full-screen, auto-cycling presentation designed for public display screens in malls, government offices, and similar venues. It rotates through all active stations automatically.

- **NLEX LED Wall Display**
  A purpose-built layout for the **North Luzon Expressway (NLEX)** large-format LED signage boards, showing live air quality data to motorists and commuters in a bold, readable format.

- **Interactive Map**
  A visual map showing where each monitoring station is located, with current weather conditions and station details accessible with a click.

- **Historical Trends & Calendar**
  Charts and a calendar heatmap showing how air quality has changed over days, weeks, and months — allowing users to spot patterns and track improvements or deteriorations.

- **Weather Integration**
  Alongside AQI data, the platform displays current weather conditions (temperature, humidity, wind speed, UV index, cloud cover, and hourly forecasts) for each station location.

- **Admin Panel**
  A secure, PIN-protected control panel for agency staff to configure display settings, manage data, view system logs, and export reports.

---

## Functions

The platform performs the following functions to deliver the above features:

- **Air Quality Index Calculation**
  Automatically converts raw particulate matter readings (PM10 and PM2.5 concentrations in µg/m³) into standardized AQI scores and color-coded categories using Philippine DENR breakpoints.

- **AQI Categories**
  | Category | AQI Range | Meaning |
  |---|---|---|
  | Good | 0 – 50 | Air quality poses little or no risk |
  | Fair | 51 – 100 | Acceptable; some pollutants may affect sensitive individuals |
  | Unhealthy for Sensitive Groups | 101 – 150 | Children, elderly, and those with respiratory conditions should limit prolonged outdoor activity |
  | Very Unhealthy | 151 – 200 | Everyone may begin to experience health effects |
  | Acutely Unhealthy | 201 – 300 | Health alert; serious effects for everyone |
  | Emergency | 301+ | Emergency conditions; entire population likely affected |

- **Real-Time Data Retrieval**
  Automatically fetches the latest readings from the monitoring stations on a regular schedule so the displayed data is always current.

- **Weather Forecasting**
  Pulls weather data for each station's location, providing a 24-hour outlook and daily forecast alongside the air quality reading.

- **Automated Report Sharing**
  Allows authorized staff to send formatted air quality reports by email directly from the platform.

- **Data Export**
  Station data can be downloaded as spreadsheet files for analysis, record-keeping, or submission to regulatory bodies.

- **Maintenance Notifications**
  When a monitoring station is temporarily offline or under maintenance, the system displays a clear notice so users are not misled by missing data.

---

## Advantages

- **Always Up-to-Date**
  Data is refreshed automatically every 15 minutes from source. If one data source is unavailable, the system falls back to backups automatically — meaning the site stays live even during data interruptions.

- **Multi-Format Display**
  The same underlying data is presented in three distinct modes (public dashboard, kiosk, and NLEX LED wall) — each optimized for its intended audience and screen size.

- **No Technical Knowledge Required**
  The public-facing dashboard uses plain language, color coding, and simple visual gauges to communicate air quality status — no scientific background needed.

- **Weather Context**
  Pairing AQI data with live weather makes it easier for users to understand air quality in context (e.g., heavy rain typically improves air quality; high winds can disperse or carry pollutants).

- **Free & Open Weather Data**
  Weather information is sourced from Open-Meteo, a free and reliable weather service, keeping operational costs minimal.

- **Designed for Philippine Standards**
  The platform is built specifically around the Philippine NAAQGV standards and DENR DAO 2000-81 thresholds — not foreign standards that may not reflect local conditions.

- **Accessible on Any Device**
  The dashboard is fully responsive, adapting its layout automatically for mobile phones, tablets, and desktop computers.

---

## NLEX Featured Overview

The **North Luzon Expressway (NLEX)** is one of the Philippines' most heavily trafficked toll roads, connecting Metro Manila to Central Luzon and serving millions of motorists every year. As part of NLEX's commitment to motorist safety and environmental awareness, air quality information from EMB Region 3 is displayed on **large-format LED signage boards** along the expressway.

### What the NLEX Display Shows

The NLEX LED wall display is a dedicated view of the monitoring system, designed to be visible and legible from a distance on a portrait-orientation signage board. It displays:

- **Station Name & Location** — which monitoring station's data is being shown
- **Current AQI Value** — the numerical index score
- **AQI Category** — the color-coded health label (e.g., "Good", "Fair", "Very Unhealthy")
- **Gauge Chart** — a visual arc indicator showing where the AQI value falls on the scale
- **Date & Time** — when the reading was last updated
- **Animated Background** — weather-aware background that changes based on current sky conditions (sunny, cloudy, rainy, etc.) to give viewers immediate visual context

### Display Modes

- **Grid Mode** — Shows all four monitoring stations simultaneously in a 2×2 layout, giving motorists a quick overview of air quality across the region.
- **Carousel Mode** — Rotates through each station one at a time on a configurable timer, allowing each station's data to be displayed prominently in full resolution.

### How It Is Managed

EMB Region 3 staff can configure the NLEX display remotely through the Admin Settings panel without needing physical access to the signage board. Settings such as which stations to show, how long each station is displayed, and whether the gauge chart appears can all be adjusted and take effect in real time.

The display is purpose-built for NLEX's LED wall hardware and optimized to be readable even at high vehicle speeds, with large fonts, bold colors, and high-contrast category labels.
