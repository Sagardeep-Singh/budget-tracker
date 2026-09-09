import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

const AppleIcon = (): ImageResponse =>
  new ImageResponse(
    <svg width="180" height="180" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="100" height="100" fill="#1a1614" />

      <circle
        cx="50"
        cy="50"
        r="25.83"
        fill="none"
        stroke="#3a2718"
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray="162.35 162.35"
        transform="rotate(-90 50 50)"
      />
      <circle
        cx="50"
        cy="50"
        r="25.83"
        fill="none"
        stroke="#dc9048"
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray="116.89 162.35"
        transform="rotate(-90 50 50)"
      />

      <circle
        cx="50"
        cy="50"
        r="11.685"
        fill="none"
        stroke="#3a2718"
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray="73.42 73.42"
        transform="rotate(-90 50 50)"
      />
      <circle
        cx="50"
        cy="50"
        r="11.685"
        fill="none"
        stroke="#dc9048"
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray="30.84 73.42"
        transform="rotate(30 50 50)"
      />
    </svg>,
    { ...size },
  );

export default AppleIcon;
