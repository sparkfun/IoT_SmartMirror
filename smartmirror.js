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
var parseXML = require('xml2js').parseString;
var ili9341 = require('jsupm_ili9341');
var apds9960 = require('jsupm_apds9960');

// Parameters
var DEBUG = 0;
var OPENWEATHER_API_KEY = "74437411d57c5685298a96fe01ea98a8";
var LATITUDE = 40.015;
var LONGITUDE = -105.27;
var UNITS = "imperial";
var TEXT_COLOR = ili9341.ILI9341_BLUE;
var LIGHT_THRESHOLD_HIGH = 2000;// Amount of light needed to start LCD
var LIGHT_THRESHOLD_LOW = 1500; // Amount of light needed to go to "sleep"
var WAIT_WEATHER = 20000;       // Amount of time (ms) between weather updates
var WAIT_GESTURE = 200;         // Amount of time (ms) between gesture updates
var STATE_CURRENT = 0;          // Looking for current weather
var STATE_HOURLY = 1;           // Get hourly forecast
var STATE_DAILY = 2;            // Get 3 day forecast
var STATE_SLEEP = 4;            // LCD off, not updating weather

// LCD object with MRAA named pins
var lcd = new ili9341.ILI9341(31, 38, 20, 14);

// Gesture sensor object using I2C bus 1
var gs = new apds9960.APDS9960(1);

// State of the weather app
var state = STATE_CURRENT;

// Currently executing threads
var sensorThread = null;
var weatherThread = null;

// Current string on LCD (used for fast erasing)
var lcdTime = null;
var lcdString = null;

// Display weather data or not
var display = false;

///////////////////////////////////////////////////////////////////////////////
// Functions
///////////////////////////////////////////////////////////////////////////////

// Convert give time to 12 hour format (AM/PM)
function convertTime(datetime) {
    
    // Convert to 12-hour clock
    var hours = datetime.getHours();
    var ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12;
    hours = hours ? hours : 12;
    
    // Append a 0 to minutes less than 10
    var minutes = datetime.getMinutes();
    minutes = minutes < 10 ? "0" + minutes : minutes;
    
    // Construct string
    var timeStr = hours + ":" + minutes + " " + ampm;
    return timeStr;
}

// Look for a gesture
function checkLightAndGesture() {

    // Check for no light and new gestures
    sensorThread = setInterval(function() {
    
        // Check light sensor
        var light = gs.readAmbientLight();
        if (DEBUG >= 2) {
            console.log("Light: " + light);
        }
        if ((display === false) && (light >= LIGHT_THRESHOLD_HIGH)) {
            if (DEBUG >= 1) {
                console.log("Lights on. Finding weather.");
            }
            display = true;
            updateWeather();
        } else if ((display === true) && (light <= LIGHT_THRESHOLD_LOW)) {
            if (DEBUG >= 1) {
                console.log("Lights off. Goodbye.");
            }
            display = false;
            state = STATE_CURRENT;
            clearTime();
            clearString();
            lcdTime = null;
            lcdString = null;
        }

        // Check for gestures and update state if gesture found
        if (display) {
            if (gs.isGestureAvailable()) {
                switch(gs.readGesture()) {
                    case apds9960.DIR_LEFT:
                        state = (state + 3) % 2;
                        if (DEBUG >= 1) {
                            console.log("LEFT gesture. Now state " + state);
                        }
                        updateWeather();
                        break;
                    case apds9960.DIR_RIGHT:
                        state = (state + 1) % 2;
                        if (DEBUG >= 1) {
                            console.log("RIGHT gesture. Now state " + state);
                        }
                        updateWeather();
                        break;
                    default:
                        break;
                }
            }
        }
    }, WAIT_GESTURE);
}

// Clear time from LCD
function clearTime() {
    lcd.setCursor(0, 10);
    lcd.setTextSize(4);
    lcd.setTextColor(ili9341.ILI9341_BLACK);
    if (DEBUG >= 2) {
        console.log("LCD: Clearing time");
    }
    lcd.print(lcdTime);
}

// Clear string from LCD
function clearString() {
    lcd.setCursor(0, 50);
    lcd.setTextSize(2);
    lcd.setTextColor(ili9341.ILI9341_BLACK);
    lcd.print(lcdString);
    if (DEBUG >= 2) {
        console.log("LCD: Clearing string");
    }
}

// Update LCD with time and a string
function updateLCD(str) {

    // Make sure we are supposed to display something
    if (display === false) {
        return;
    }
    
    // Get time
    timeStr = convertTime(new Date());
    
    // Skip if time is the same
    if (timeStr !== lcdTime) {
    
        // Configure text parameters
        lcd.setCursor(0, 10);
        lcd.setTextWrap(false);
        
        // Erase previous time
        if (lcdTime !== null) {
            clearTime();
        }
    
        // Write new time
        lcd.setCursor(0, 10);
        lcd.setTextSize(4);
        if (DEBUG >= 2) {
            console.log("LCD: Writing time");
        }
        lcd.setTextColor(ili9341.ILI9341_CYAN);
        lcd.print(timeStr);   
    }
    
    // Skip if text is the same
    if (str !== lcdString) {
        
        // Erase previous text
        if (lcdString !== null) {
            clearString();
        }
    
        // Write new text
        lcd.setCursor(0, 50);
        lcd.setTextSize(2);
        if (DEBUG >= 2) {
            console.log("LCD: Writing string");
        }
        lcd.setTextColor(ili9341.ILI9341_CYAN);
        lcd.print(str);
    }
        
    lcdTime = timeStr;
    lcdString = str;
}    

// A function to make a request to the OpenWeatherMap API for current weather
function getWeather() {

    // Construct API call to OpenWeatherMap
    var owmReq = "http://api.openweathermap.org/data/2.5/weather?" +
                    "lat=" + LATITUDE + "&lon=" + LONGITUDE + 
                    "&appid=" + OPENWEATHER_API_KEY + "&units=" + UNITS +
                    "&mode=xml";

    // Make the request
    var request = http.get(owmReq, function(response) {

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
                
                    // Parse the XML to get the pieces we need
                    parseXML(body, function(err, result) {
                        
                        // Get the city
                        var city = result.current.city[0].$.name;
                        
                        // Get the temperature
                        var temperature = result.current.temperature[0].$.value;
                        temperature = Math.round(temperature * 10) / 10;
                        
                        // Find temperature units
                        var tempUnits = "C";
                        if (UNITS === "imperial") {
                            tempUnits = "F";
                        }
                        
                        // Get the weather description
                        var description = result.current.weather[0].$.value;
                        
                        // Get wind information
                        var wind = result.current.wind[0];
                        var windSpeed = wind.speed[0].$.value;
                        var windDir = wind.direction[0].$.code;
                        windSpeed = Math.round(windSpeed * 10) / 10;
                        
                        // Find speed units
                        var speedUnits = "m/s";
                        if (UNITS === "imperial") {
                            speedUnits = "mph";
                        }
                        
                        // Find high and low temperatures for the day
                        var minTemp = result.current.temperature[0].$.min;
                        var maxTemp = result.current.temperature[0].$.max;
                        minTemp = Math.round(minTemp * 10) / 10;
                        maxTemp = Math.round(maxTemp * 10) / 10;
                        
                        // Print the information for debugging
                        if (DEBUG >= 2) {
                            console.log(city);
                            console.log(temperature + tempUnits);
                            console.log(description);
                            console.log(windSpeed + speedUnits);
                            console.log(windDir);
                            console.log("High: " + maxTemp + tempUnits);
                            console.log("Low: " + minTemp + tempUnits);
                        }
                        
                        // Update the LCD with current weather
                        updateLCD(city + "\n" +
                                    temperature + tempUnits + "\n" +
                                    description + "\n" +
                                    "\n" +
                                    "Wind: " + windSpeed + speedUnits + 
                                    " " + windDir + "\n" +
                                    "\n" +
                                    "High: " + maxTemp + tempUnits + "\n" +
                                    "Low:  " + minTemp + tempUnits);
                    });
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

// A function to make a request to the OpenWeatherMap API for hourly forecast
function getHourly() {

    // Construct API call to OpenWeatherMap
    var owmReq = "http://api.openweathermap.org/data/2.5/forecast?" +
                    "lat=" + LATITUDE + "&lon=" + LONGITUDE +
                    "&appid=" + OPENWEATHER_API_KEY + "&units=" + UNITS +
                    "&mode=xml";

    // Make the request
    var request = http.get(owmReq, function(response) {

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

                    // Parse the XML to get the pieces we need
                    parseXML(body, function(err, result) {

                        // Get the city
                        var city = result.weatherdata.location[0].name[0];
                        
                        // Get forecast data
                        var forecast = result.weatherdata.forecast[0].time;
                        var numEntries = forecast.length;
                        var numEntries = Math.min(numEntries, 4);
                        var weather = [];
                        var datetime;
                        var temperature;
                        var windSpeed;
                        for (var i = 0; i < numEntries; i++) {
                            datetime = new Date(forecast[i].$.to);
                            temperature = forecast[i].temperature[0].$.value;
                            windSpeed = forecast[i].windSpeed[0].$.mps;
                            weather.push({
                                time : convertTime(datetime),
                                temp : Math.round(temperature * 10) / 10,
                                windSp : Math.round(windSpeed * 10) / 10,
                                windDir : forecast[i].windDirection[0].$.code
                            });
                        }
                        
                        // Find units
                        var tempUnits = "C";
                        var speedUnits = "m/s";
                        if (UNITS === "imperial") {
                            tempUnits = "F";
                            speedUnits = "mph";
                        }

                        // Print the information for debugging
                        if (DEBUG >= 2) {
                            console.log(city);
                            for (i = 0; i < numEntries; i++) {
                                console.log(weather[i]);
                            }
                        }
                        
                        // Construct the string to display
                        forecastStr = city;
                        for (i = 0; i < numEntries; i++) {
                            forecastStr += "\n\n";
                            forecastStr += weather[i].time + " ";
                            forecastStr += weather[i].temp + tempUnits + "\n";
                            forecastStr += "Wind: ";
                            forecastStr += weather[i].windSp + speedUnits;
                            forecastStr += " " + weather[i].windDir;
                        }

                        // Update the LCD with current weather
                        updateLCD(forecastStr);
                    });
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

    // If there is an existing timeout thread, clear it
    if (weatherThread !== null) {
        clearTimeout(weatherThread);
    }
    
    // Find the weather (only if display is on)
    if (display) {
        switch(state) {
            case STATE_CURRENT:
                if (DEBUG >= 1) {
                    console.log("Getting current weather");
                }
                getWeather();
                break;
            case STATE_HOURLY:
                if (DEBUG >= 1) {
                    console.log("Getting hourly forecast");
                }
                getHourly();
                break;
            default:
                break;
        }
    }
    
    // Call this function again      
    weatherThread = setTimeout(updateWeather, WAIT_WEATHER);
}

///////////////////////////////////////////////////////////////////////////////
// Execution starts here
///////////////////////////////////////////////////////////////////////////////

// Init gesture sensor
if (!gs.init()) {
    console.log("Error with gesture sensor init");
    process.exit(1);
}

// Enable light sensor without interrupts
if (gs.enableLightSensor(false)) {
    if (DEBUG >= 1) {
        console.log("Light sensor is running");
    }
} else {
    console.log("Error enabling light sensor");
}

// Enable gesture sensor without interrupts
if (gs.enableGestureSensor(false)) {
    if (DEBUG >= 1) {
        console.log("Gesture sensor is running");
    }
} else {
    console.log("Error enabling gesture sensor");
}

// Clear LCD and wait for light. Start polling weather.
if (DEBUG === 0) {
    lcd.fillScreen(ili9341.ILI9341_BLACK);
}
updateWeather();
checkLightAndGesture();