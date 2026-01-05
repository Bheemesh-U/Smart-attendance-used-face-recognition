# Smart Attendance System 🎓

An advanced, AI-powered attendance management platform designed for modern educational institutions. This system leverages **Facial Recognition** for automated attendance and provides comprehensive dashboards for Students, Teachers, and Administrators.

## 🚀 Features

- **🤖 AI Face Attendance**: Automated attendance marking using real-time facial recognition (powered by `face-api.js`).
- **📊 Interactive Dashboards**: Dedicated views for Students (Academic Stats), Teachers (Class Management), and Admins.
- **📅 Smart Syllabus Tracking**: Dynamic semester-wise subjects and lab lists tailored to branches (CSE, CAI, ECE, etc.).
- **☁️ Cloud-Powered**: Built on **Firebase** for real-time data syncing, authentication, and secure storage.
- **🛡️ Role-Based Access**: Secure login with separation of concerns for different user roles.
- **📱 Responsive Design**: A modern, glassmorphism-inspired UI built with Tailwind CSS.

## 🛠️ Technology Stack

- **Frontend**: HTML5, Vanilla JavaScript (ES6+), Tailwind CSS (CDN).
- **AI/ML**: `face-api.js` (TensorFlow.js based) for client-side face recognition.
- **Backend**: Firebase (Serverless).
- **Database**: Cloud Firestore (NoSQL).
- **Authentication**: Firebase Auth.

## 📂 Project Structure

```
smart/
├── css/
│   └── style.css          # Custom styles & Tailwind directives
├── js/
│   ├── app.js             # Main application logic (UI, Routing, Dashboards)
│   ├── sdk.js             # Firebase & Data Layer configuration
│   └── face-recognition.js # AI Logic for face detection
├── index.html             # Entry point (Login/App Container)
└── seeder.html            # Utility to seed demo data into Firebase
```

## ⚡ Quick Start

1.  **Clone/Download** the repository.
2.  **Serve the directory**:
    - You **must** use a local server (e.g., VS Code "Live Server" extension) because `face-api.js` and camera permissions require a secure context (localhost/https).
    - Do not just double-click `index.html`.
3.  **Open in Browser**: Go to `http://127.0.0.1:5500/index.html` (or your server port).
4.  **Allow Permissions**: Grant camera access when prompted for the Face Attendance feature.

## 🔐 Demo Credentials

Use these accounts to explore the system:

| Role | Username / Reg No | Password |
| :--- | :--- | :--- |
| **Student** (CSE) | `23G31A0509` | `pass123` |
| **Student** (CAI) | `23G31A3193` | `pass123` |
| **Teacher** | `teacher001` | `pass123` |
| **Admin** | `admin001` | `pass123` |

## 🧩 Key Functionalities

### 1. Face Attendance
- Navigate to the dashboard.
- Click the Camera icon 📷.
- The system will detect faces (amber box) and recognize registered students (green box).
- Attendance is marked automatically with a "Success" notification.

### 2. Syllabus View
- Check the "Semester Subjects" tab.
- Views are customized based on the logged-in student's branch (e.g., CSE vs ECE).

### 3. Holiday Logic
- Attendance is automatically disabled on **Sundays** and public holidays (configured in `app.js`).

## 📜 License
This project is for educational purposes.
