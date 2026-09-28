function RushlightLogo({ size = 72 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 80 80"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* wax-seal disc */}
      <circle cx="40" cy="40" r="38" fill="#241c11" stroke="#3d2f1c" strokeWidth="2" />
      <circle cx="40" cy="40" r="32" fill="none" stroke="#3d2f1c" strokeWidth="1" opacity="0.6" />

      {/* outer flame — deeper amber */}
      <path
        d="M40 15 C 30 25, 25 35, 28 48 C 30 56, 36 60, 40 60 C 44 60, 50 56, 52 48 C 55 35, 50 25, 40 15 Z"
        fill="#b8622a"
      />

      {/* inner flame — brighter amber, the "hot" core */}
      <path
        d="M40 28 C 35 34, 33 40, 35 46 C 37 50, 40 52, 40 52 C 40 52, 43 50, 45 46 C 47 40, 45 34, 40 28 Z"
        fill="#d9903f"
      />
    </svg>
  )
}

export default RushlightLogo
