/**
 * IoT_SmartMirror
 *
 * Shows weather data on an LCD. Controlled with hand gestures. If ambient
 * rises above a threshold, the LCD display turns on and shows current 
 * weather. Swipe left/right to cycle to wind data and 5 day forecast.
 *
 * Wire connections:
 *
 * LCD          Edison (Pi Block)
 * -----------------------------
 * GND          GND
 * Vin          3.3V
 * CLK          SCK
 * MOSI         MOSI
 * CS           GP44 (MRAA 31)
 * DC           GP12 (MRAA 20)
 * RST          GP13 (MRAA 14)
 *
 * APDS-9960    Edison (Pi Block)
 * ------------------------------
 * GND          GND
 * VCC          3.3V
 * SDA          SDA
 * SCL          SCL
 */

/**
 * Author: Shawn Hymel
 * Copyright (c) 2016 SparkFun Electronics
 *
 * Permission is hereby granted, free of charge, to any person obtaining
 * a copy of this software and associated documentation files (the
 * "Software"), to deal in the Software without restriction, including
 * without limitation the rights to use, copy, modify, merge, publish,
 * distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so, subject to
 * the following conditions:
 *
 * The above copyright notice and this permission notice shall be
 * included in all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 * EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
 * LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
 * OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
 * WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */
 
// Parameters
var DEBUG = 1;
var LIGHT_THRESHOLD_HIGH = 100;     // When to turn on LCD

var ili9341 = require('jsupm_ili9341');
var apds9960 = require('jsupm_apds9960');

// LCD object with MRAA named pins
var lcd = new ili9341.ILI9341(31, 38, 20, 14);

// Gesture sensor object using I2C bus 1
var gs = new apds9960.APDS9960(1);

// Currently executing thread
var thread = null;

///////////////////////////////////////////////////////////////////////////////
// Functions
///////////////////////////////////////////////////////////////////////////////

// Output debugging information to the console
function debug(str) {
    if (DEBUG === 1) {
        console.log(str);
    }
}

// Read and return the ambient light value in the room
function readLight() {
    var lightVal = gs.readAmbientLight();
    debug("Light: " + lightVal);
    return lightVal;
}

// Shut down LCD and wait for light
function waitForLight() {
    thread = setInterval(function() {
        if (readLight() >= LIGHT_THRESHOLD_HIGH) {
            debug("Light found! Starting weather...");
            clearInterval(thread);
        }
    }, 500);
}

// Fill

///////////////////////////////////////////////////////////////////////////////
// Execution starts here
///////////////////////////////////////////////////////////////////////////////

// Init gesture sensor
if (!gs.init()) {
    debug("Error with gesture sensor init");
    process.exit(1);
}

// Enable light sensor with interrupts
if (!gs.enableLightSensor(true)) {
    debug("Error enabling light sensor");
    process.exit(1);
}

// Clear LCD and wait for light
//lcd.fillScreen(ili9341.ILI9341_BLACK);
waitForLight();