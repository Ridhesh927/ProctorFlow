import http from 'k6/http';
import { check, sleep } from 'k6';

// Test configuration
export const options = {
  stages: [
    { duration: '10s', target: 50 }, // Ramp-up to 5 users over 10 seconds
    { duration: '20s', target: 50 }, // Stay at 5 users for 20 seconds
    { duration: '10s', target: 100 }, // Ramp-down to 0 users
  ],
  thresholds: {
    http_req_duration: ['p(95)<1500'], // 95% of requests must complete below 500ms
  },
};

export default function () {
  // Test data - using a sample login payload
  // Ensure this PRN exists or adapt as needed for your DB
  const payload = JSON.stringify({
    prn_number: '003',
    password: 'User3@1234',
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
  };

  // Backend login endpoint
  let res = http.post('http://localhost:5000/api/auth/student/login', payload, params);

  // Check if login was successful
  let success = check(res, {
    'is status 200': (r) => r.status === 200,
  });

  if (!success) {
    console.log(`Login Failed! Status: ${res.status}, Body: ${res.body}`);
  }

  sleep(1);
}
