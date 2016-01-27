/**
 * IoT_SmartMirror
 * Author: Shawn Hymel
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
 
var http = require('http');
var ili9341 = require('jsupm_ili9341');
var apds9960 = require('jsupm_apds9960');

// Parameters
var CITY_STR = "Boulder, CO";   // Your city and region/state
var TEXT_COLOR = ili9341.ILI9341_BLUE;
var LIGHT_THRESHOLD_HIGH = 100; // Amount of light needed to start LCD
var WAIT_WEATHER = 5000;        // Amount of time (ms) between weather updates

// LCD object with MRAA named pins
var lcd = new ili9341.ILI9341(31, 38, 20, 14);

// Gesture sensor object using I2C bus 1
var gs = new apds9960.APDS9960(1);

// Currently executing thread
var thread = null;

// Current string on LCD (used for fast erasing)
var lcdTime = null;
var lcdString = null;

///////////////////////////////////////////////////////////////////////////////
// Functions
///////////////////////////////////////////////////////////////////////////////

// Read and return the ambient light value in the room
function readLight() {
    var lightVal = gs.readAmbientLight();
    console.log("Light: " + lightVal);
    return lightVal;
}

// Shut down LCD and wait for light
function waitForLight() {
    lcd.fillScreen(ili9341.ILI9341_BLACK);
    thread = setInterval(function() {
        if (readLight() >= LIGHT_THRESHOLD_HIGH) {
            console.log("Light found! Starting weather...");
            clearInterval(thread);
            updateWeather();
        }
    }, 500);
}

// Update LCD with time and a string
function updateLCD(str) {
    
    // Get time
    var currentTime = new Date();
    var hours = currentTime.getHours();
    var minutes = currentTime.getMinutes();
    if (minutes < 10) {
        minutes = "0" + minutes;
    }
    var timeStr = hours + ":" + minutes;
    
    // Skip if time is the same
    if (timeStr !== lcdTime) {
    
        // Configure text parameters
        lcd.setCursor(0, 10);
        lcd.setTextWrap(false);
        lcd.setTextSize(4);
        
        // Erase previous time
        if (lcdTime !== null) {
            lcd.setCursor(0, 10);
            lcd.setTextColor(ili9341.ILI9341_BLACK);
            console.log("LCD: Clearing time");
            lcd.print(lcdTime);
        }
    
        // Write new time
        lcd.setCursor(0, 10);
        console.log("LCD: Writing time");
        lcd.setTextColor(ili9341.ILI9341_CYAN);
        lcd.print(timeStr);   
    }
    
    // Skip if text is the same
    if (str !== lcdString) {
        
        // Erase previous text
        lcd.setTextSize(2)
        if (lcdString !== null) {
            lcd.setCursor(0, 50);
            lcd.setTextColor(ili9341.ILI9341_BLACK);
            lcd.print(lcdString);
            console.log("LCD: Clearing string");
        }
    
        // Write new text
        lcd.setCursor(0, 50);
        console.log("LCD: " + str);
        lcd.setTextColor(ili9341.ILI9341_CYAN);
        lcd.print(str);
    }
        
    lcdTime = timeStr;
    lcdString = str;
}    

// A function to make a request to the Yahoo Weather API
function getTemperature() {

    // Construct YQL (https://developer.yahoo.com/weather/)
    var yql = "select * from weather.forecast where woeid in " +
              "(select woeid from geo.places(1) where text='" + CITY_STR + "')";

    // Construct GET request
    var getReq = "http://query.yahooapis.com/v1/public/yql?q=" +
                    yql.replace(/ /g,"%20") +
                    "&format=json&env=store%3A%2F%2Fdatatables.org%2" +
                    "Falltableswithkeys";

    // Make the request
    var request = http.get(getReq, function(response) {

        // Where we store the response text
        var body = '';

        //Read the data
        response.on('data', function(chunk) {
            body += chunk;
        });

        // Print out the data once we have received all of it
        response.on('end', function() {
            if (response.statusCode === 200) {
                try {

                    // Parse the JSON to get the pieces we need
                    var weatherResp = JSON.parse(body);
                    var channelResp = weatherResp.query.results.channel;
                    var conditionResp = channelResp.item.condition;

                    // Extract the city and region
                    var city = channelResp.location.city;
                    var region = channelResp.location.region;

                    // Get the local weather
                    var temperature = conditionResp.temp;
                    var tempUnit = channelResp.units.temperature;
                    var description = conditionResp.text;

                    // Create string and update LCD
                    var weather = city + ", " + region + "\n" +
                                    temperature +
                                    tempUnit + " " + description;
                                    
                    // Get the time and update LCD
                    updateLCD(weather);
                    
                } catch(error) {

                    // Report problem with parsing the JSON
                    console.log("Parsing error: " + error);
                }
            } else {

                // Report problem with the response
                console.log("Response error: " +
                            http.STATUS_CODES[response.statusCode]);
            }
        })
    });

    // Report a problem with the connection
    request.on('error', function (err) {
        console.log("Connection error: " + err);
    });
}

// Start getting weather data
function updateWeather() {
    getTemperature();
    setTimeout(updateWeather, WAIT_WEATHER);
}

///////////////////////////////////////////////////////////////////////////////
// Execution starts here
///////////////////////////////////////////////////////////////////////////////

// Init gesture sensor
if (!gs.init()) {
    console.log("Error with gesture sensor init");
    process.exit(1);
}

// Enable light sensor with interrupts
if (!gs.enableLightSensor(true)) {
    console.log("Error enabling light sensor");
    process.exit(1);
}

// Clear LCD and wait for light
waitForLight();
