const express = require('express');
const cors = require('cors');
const axios = require('axios');
const turf = require('@turf/turf');
const app = express();

app.use(cors());
app.use(express.json());

// --- DATABASE ---
let activeRides = [];
let driverNotification = null; // The "Mailbox" for the driver

// Helper: Get Route Shape
async function getRouteGeometry(start, end) {
    const url = `https://router.project-osrm.org/route/v1/driving/${start[1]},${start[0]};${end[1]},${end[0]}?overview=full&geometries=geojson`;
    try {
        const res = await axios.get(url);
        if (res.data.routes && res.data.routes.length > 0) {
            return res.data.routes[0].geometry;
        }
        return null;
    } catch (e) { return null; }
}

// --- BOOKING ENDPOINT ---
app.post('/book-ride', async (req, res) => {
    const { pickup, drop, pickupCoords, dropCoords, isShared } = req.body;
    console.log(`\n🚗 Request: ${pickup} -> ${drop} | Shared: ${isShared}`);

    try {
        let pooled = false;

        // 1. IF SHARING, LOOK FOR DRIVER
        if (isShared) {
            for (const ride of activeRides) {
                if (!ride.routeGeometry) continue;

                // MATH: Check if passenger is near driver's route
                const routeLine = turf.lineString(ride.routeGeometry.coordinates);
                const passengerPoint = turf.point([pickupCoords[1], pickupCoords[0]]);
                const distance = turf.pointToLineDistance(passengerPoint, routeLine, { units: 'kilometers' });

                console.log(`   -> Distance to driver's route: ${distance.toFixed(2)}km`);

                // DEMO SETTING: Match if under 10km (Guarantees it works for presentation)
                if (distance < 10) {
                    pooled = true;

                    // SEND NOTIFICATION TO DRIVER
                    driverNotification = {
                        message: `🔔 NEW PASSENGER ALERT!\nLocation: ${pickup}\nThey are ${distance.toFixed(2)}km from your path.`,
                        pickup: pickup
                    };
                    console.log("   ✅ MATCH FOUND! Notification sent to driver.");

                    res.json({
                        success: true,
                        isPooled: true,
                        message: `<b>Match Found!</b><br>Driver is passing by (${distance.toFixed(2)}km away).`
                    });
                    break;
                }
            }
        }

        // 2. IF NO MATCH, BECOME A DRIVER
        if (!pooled) {
            const geometry = await getRouteGeometry(pickupCoords, dropCoords);
            const newRide = { id: Date.now(), pickup, drop, routeGeometry: geometry };
            activeRides.push(newRide);
            console.log("   -> New Driver added to system.");

            res.json({
                success: true,
                isPooled: false,
                message: "You are the Driver. Waiting for passengers..."
            });
        }

    } catch (err) {
        console.log(err);
        res.status(500).json({ success: false, message: "Server Error" });
    }
});

// --- DRIVER POLLING ENDPOINT ---
app.get('/check-updates', (req, res) => {
    if (driverNotification) {
        res.json({ hasUpdate: true, data: driverNotification });
        driverNotification = null; // Clear message after reading (prevents loops)
    } else {
        res.json({ hasUpdate: false });
    }
});

app.listen(3000, () => console.log('🚀 Server running on port 3000'));