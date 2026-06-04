// จำลองข้อมูล Bosch MQTT สำหรับทดสอบ
const mqtt = require('mqtt');
const client = mqtt.connect('mqtt://localhost:1883');

const cameras = ['BoschCam1', 'BoschCam2', 'BoschCam3'];
const classes = ['Person', 'Car', 'Truck', 'Bicycle'];

client.on('connect', () => {
  console.log('🎬 Simulator connected, sending fake events...');

  setInterval(() => {
    const cam = cameras[Math.floor(Math.random() * cameras.length)];
    const cls = classes[Math.floor(Math.random() * classes.length)];
    const now = new Date().toISOString();
    const eventType = Math.random();

    if (eventType < 0.3) {
      // Line Crossing with Object Properties
      client.publish(
        `${cam}/onvif-ej/RuleEngine/LineDetector/Crossed/&1/Crossing_line_1`,
        JSON.stringify({
          UtcTime: now,
          Source: { VideoSource: '1', Rule: 'Crossing_line_1' },
          Data: { Object: { Object: {
            '@ObjectId': Math.floor(Math.random() * 9000) + 1000,
            Appearance: { Class: { Type: {
              '@Likelihood': +(0.7 + Math.random() * 0.3).toFixed(2),
              '#text': cls
            }}}
          }}}
        })
      );
    } else if (eventType < 0.5) {
      // Counter
      client.publish(
        `${cam}/onvif-ej/RuleEngine/CountAggregation/Counter/&1/Counter_1`,
        JSON.stringify({
          UtcTime: now,
          Source: { VideoSource: '1', Rule: 'Counter_1' },
          Data: { Count: Math.floor(Math.random() * 200) }
        })
      );
    } else if (eventType < 0.7) {
      // Motion Alarm
      client.publish(
        `${cam}/onvif-ej/VideoSource/MotionAlarm/&1`,
        JSON.stringify({
          UtcTime: now,
          Source: { Source: '1' },
          Data: { State: true }
        })
      );
    } else if (eventType < 0.85) {
      // Loitering
      client.publish(
        `${cam}/onvif-ej/RuleEngine/FieldDetector/ObjectIsLoitering/&1/Loitering_1`,
        JSON.stringify({
          UtcTime: now,
          Source: { VideoSource: '1', Rule: 'Loitering_1' },
          Data: { Status: Math.random() > 0.5 }
        })
      );
    } else {
      // LPR
      const plates = ['กท1234', '2กข5678', '3ขก9012', 'SN66XMZ'];
      client.publish(
        `${cam}/onvif-ej/RuleEngine/Recognition/LicensePlate/&1/LPR-Detector_1`,
        JSON.stringify({
          UtcTime: now,
          Source: { VideoSource: '1', Rule: 'LPR-Detector_1' },
          Data: {
            Likelihood: '0.92',
            LicensePlateInfo: { LicensePlateInfo: {
              PlateNumber: { '@Likelihood': 0.92, '#text': plates[Math.floor(Math.random() * plates.length)] },
              PlateType: { '#text': 'Normal' },
              CountryCode: { '#text': 'TH' },
              IssuingEntity: { '#text': 'BKK' }
            }},
            VehicleInfo: { VehicleInfo: {
              Type: { '@Likelihood': 1, '#text': 'Car' },
              Brand: { '@Likelihood': 0.9, '#text': 'Toyota' },
              Model: { '@Likelihood': 0.85, '#text': 'Camry' }
            }}
          }
        })
      );
    }
  }, 2000); // ส่งทุก 2 วินาที
});