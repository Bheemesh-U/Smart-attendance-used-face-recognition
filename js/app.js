// Default configuration
import { faceRecognition } from './face-recognition.js';
const defaultConfig = {
  background_color: "#f8fafc",
  primary_color: "#6366f1",
  text_color: "#0f172a",
  card_color: "rgba(255, 255, 255, 0.85)",
  accent_color: "#a855f7",
  font_family: "Outfit",
  font_size: 16,
  system_title: "Smart Attendance",
  institution_name: "Excellence University",
  welcome_message: "Welcome to your Dashboard",
  ahs_label: "Academic Health",
  face_attendance_label: "AI Attendance",
  holidays: {
    "2026-01-01": "New Year's Day",
    "2026-01-14": "Pongal",
    "2026-01-15": "Makar Sankranti",
    "2026-01-26": "Republic Day",
    "2026-03-25": "Holi",
    "2026-08-15": "Independence Day",
    "2026-10-02": "Gandhi Jayanti",
    "2026-12-25": "Christmas"
  }
};

// Application state
// Application state
let currentUser = null;
let currentStudentView = 'home';
let allData = [];
let isLoading = false;
let videoStream = null;
let isCameraActive = false;
let isScanning = false;
let isRecognitionPaused = false;
let detectedFacesCount = 0;
let lastAttendanceMarkedTime = {};
let clockInterval = null; // only one dashboard clock may run

// Demo User Mapping
const demoUsers = {
  'admin001': { email: 'admin@example.com', role: 'admin', name: 'Super Admin', registration_no: 'ADM2019001' },
  'teacher001': { email: 'teacher1@example.com', role: 'teacher', name: 'Dr. Priya Patel', registration_no: 'TCH2020045' },
  'teacher002': { email: 'teacher2@example.com', role: 'teacher', name: 'Prof. Amit Verma', registration_no: 'TCH2021022' },
  // New Student Database
  '23G31A3183': { name: "U.Bheemesh", registration_no: "23G31A3183", branch: "CAI", year: "III", mobile_number: "6302750463", role: 'student', email: '23g31a3183@example.com' },
  '23G31A0509': { name: "B.Mahendra", registration_no: "23G31A0509", branch: "CSE", year: "III", mobile_number: "9000000002", role: 'student', email: '23g31a0509@example.com' },
  '23G31A0454': { name: "K.Sathees", registration_no: "23G31A0454", branch: "ECE", year: "III", mobile_number: "9391405338", role: 'student', email: '23g31a0454@example.com' },
  '23G31A3116': { name: "B.Vinay", registration_no: "23G31A3116", branch: "CAI", year: "III", mobile_number: "9000000004", role: 'student', email: '23g31a3116@example.com' },
  '23G31A0536': { name: "K.Thiru", registration_no: "23G31A0536", branch: "CSE", year: "III", mobile_number: "9000000005", role: 'student', email: '23g31a0536@example.com' },

  '23G31A0477': { name: "M.Kiran", registration_no: "23G31A0477", branch: "ECE", year: "III", mobile_number: "6304703592", role: 'student', email: '23g31a0477@example.com' },
  '23G31A0406': { name: "K.Gopi", registration_no: "23G31A0406", branch: "ECE", year: "III", mobile_number: "9000000007", role: 'student', email: '23g31a0406@example.com', is_lateral: true },
  '23G31A3193': { name: "K.Suresh", registration_no: "23G31A3193", branch: "CAI", year: "III", mobile_number: "9000000008", role: 'student', email: '23g31a3193@example.com' },
  '23G31A3224': { name: "B.Vamsi", registration_no: "23G31A3224", branch: "CSD", year: "III", mobile_number: "9000000009", role: 'student', email: '23g31a3224@example.com' }
};
// Initialize Data SDK
const dataHandler = {
  async onDataChanged(data) {
    allData = data;

    // Hydrate users from DB to merge with hardcoded demoUsers
    try {
      const dbUsers = await window.dataSdk.getAllUsers();
      dbUsers.forEach(u => {
        demoUsers[u.registration_no] = { ...demoUsers[u.registration_no], ...u };
      });
      console.log(`✓ Hydrated ${dbUsers.length} users from Firestore`);
    } catch (err) {
      console.warn("Failed to hydrate users:", err);
    }

    if (currentUser) {
      renderDashboard();
    }
  }
};

// Calculate Academic Health Score
function calculateAHS(attendance, cgpa, certificatesCount) {
  const attendanceScore = attendance * 0.4;
  const cgpaScore = (cgpa / 10) * 100 * 0.4;
  const certificatesScore = Math.min(certificatesCount * 5, 20);
  const ahs = attendanceScore + cgpaScore + certificatesScore;

  let status = 'Risk';
  if (ahs >= 75) status = 'Good';
  else if (ahs >= 50) status = 'Warning';

  return { score: Math.round(ahs), status };
}
// Check if attendance is allowed (Not Sunday or Holiday)
function checkAttendanceAllowed() {
  const now = new Date();
  const day = now.getDay(); // 0 = Sunday
  const dateStr = now.toISOString().split('T')[0];
  const config = window.elementSdk.config || defaultConfig;
  const holidays = config.holidays || defaultConfig.holidays;

  // 1. Check Sunday
  if (day === 0) {
    return { allowed: false, reason: "Today is Sunday (Holiday)" };
  }

  // 2. Check Holiday List
  if (holidays && holidays[dateStr]) {
    return { allowed: false, reason: `Today is ${holidays[dateStr]} (Holiday)` };
  }

  return { allowed: true };
};


// Initialize Face Recognition (simulated with camera access)
async function initializeFaceRecognition() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: 640, height: 480 }
    });
    videoStream = stream;
    return true;
  } catch (error) {
    console.error('Camera access error:', error);
    return false;
  }
}

// Mark attendance automatically
async function markAttendanceAutomatically(student, confidence, confidencePct) {
  const status = checkAttendanceAllowed();
  if (!status.allowed) {
    showNotification(`Attendance Disabled: ${status.reason}`, 'error');
    return;
  }

  // Local calendar date (toISOString() would be the previous day for evening hours in +IST)
  const today = new Date().toLocaleDateString('en-CA');

  // Check if already marked today
  const existingRecord = allData.find(record =>
    record.type === 'attendance' &&
    record.student_id === student.registration_no &&
    record.date === today
  );

  if (existingRecord) {
    return;
  }

  const attendanceRecord = {
    type: 'attendance',
    student_id: student.registration_no,
    student_name: student.name,
    date: today,
    present: true,
    auto_marked: true,
    // face-api's distance (lower = better) is not a percentage; store the real (1-d) confidence
    recognition_confidence: Math.round(confidencePct ?? ((1 - confidence) * 100)),
    created_at: new Date().toISOString()
  };

  const result = await window.dataSdk.create(attendanceRecord);

  if (!result.isOk) {
    showNotification('Error marking attendance', 'error');
  }
}

// Start camera
async function startCamera() {
  if (isCameraActive) return; // prevent double-start from re-renders

  const hasCamera = await initializeFaceRecognition();
  if (!hasCamera) {
    showCameraPermissionHelp();
    return; // do not mark the camera as active when permission failed
  }

  isCameraActive = true;

  const video = document.getElementById('faceVideo');
  const canvas = document.getElementById('faceOverlay');

  if (video && videoStream) {
    video.srcObject = videoStream;
    await new Promise(resolve => video.onloadedmetadata = resolve);
    video.play();

    // Start AI scanning (model errors are surfaced to the UI instead of failing silently)
    startAiScanning(video, canvas).catch(err => {
      console.error('AI scanning failed to start:', err);
      showNotification('⚠️ ' + err.message, 'error');
    });
  }

  updateCameraUI();
  showNotification('📸 CCTV Monitor activated. Students will be recognized automatically.', 'info');
}

// AI Scanning Loop
async function startAiScanning(video, canvas) {
  if (isScanning) return; // already running
  isScanning = true;

  // Preload models up-front so failures surface here, before the loop starts
  await faceRecognition.loadModels();

  // Ensure we have student data for recognition
  const students = Object.values(demoUsers).filter(u => u.role === 'student');
  await faceRecognition.initLabeledDescriptors(students);

  async function scan() {
    if (!isScanning || !isCameraActive) return;

    if (isRecognitionPaused) {
      // elements can be re-created on re-render; look them up each frame
      const overlay = document.getElementById('faceOverlay');
      if (overlay) overlay.getContext('2d').clearRect(0, 0, overlay.width, overlay.height);
      requestAnimationFrame(scan);
      return;
    }

    try {
      // elements can be re-created on re-render; use the fresh ones each frame
      const liveVideo = document.getElementById('faceVideo');
      const liveCanvas = document.getElementById('faceOverlay');
      if (liveVideo && liveCanvas) {
        detectedFacesCount = await faceRecognition.detectAndIdentify(liveVideo, liveCanvas, students);

        const countEl = document.getElementById('faceCount');
        if (countEl) countEl.textContent = detectedFacesCount;
      }
    } catch (err) {
      console.error('Scanning error:', err);
    }

    requestAnimationFrame(scan);
  }

  scan();
}

// Listener for recognized faces from face-recognition.js
window.addEventListener('faceRecognized', async (e) => {
  const { student, confidence, confidencePct } = e.detail;
  const now = Date.now();

  // Mark each student at most once per session
  if (lastAttendanceMarkedTime[student.registration_no]) {
    return;
  }
  lastAttendanceMarkedTime[student.registration_no] = now;

  // Pause recognition briefly to show the "Success" state clearly
  isRecognitionPaused = true;
  await markAttendanceAutomatically(student, confidence, confidencePct);
  showNotification(`✓ ${student.name} marked present`, 'success');

  setTimeout(() => {
    isRecognitionPaused = false;
  }, 3000);
});

// Show notification (Dynamic)
function showNotification(message, type = 'info') {
  const div = document.createElement('div');
  div.className = `fixed top-4 right-4 z-50 px-6 py-4 rounded-xl shadow-2xl transform transition-all duration-500 translate-y-[-100%] ${type === 'error' ? 'bg-red-500 text-white' :
    type === 'success' ? 'bg-emerald-500 text-white' :
      'bg-blue-500 text-white'
    }`;
  div.innerHTML = `<div class="flex items-center gap-3"><span class="font-bold text-lg">${type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ'}</span><p class="font-medium">${message}</p></div>`;
  document.body.appendChild(div);

  // Animate in
  requestAnimationFrame(() => div.classList.remove('translate-y-[-100%]'));

  // Remove after 3s
  setTimeout(() => {
    div.classList.add('translate-y-[-100%]', 'opacity-0');
    setTimeout(() => div.remove(), 500);
  }, 3000);
}

// Stop camera
function stopCamera() {
  if (videoStream) {
    videoStream.getTracks().forEach(track => track.stop());
    videoStream = null;
  }
  isCameraActive = false;
  isScanning = false;

  const video = document.getElementById('faceVideo');
  if (video) {
    video.srcObject = null;
  }

  const canvas = document.getElementById('faceOverlay');
  if (canvas) {
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  }

  updateCameraUI();
}

// Update camera UI
function updateCameraUI() {
  const cameraBtn = document.getElementById('cameraButton');
  const statusText = document.getElementById('cameraStatus');
  const videoContainer = document.getElementById('videoContainer');

  if (cameraBtn && statusText) {
    if (isCameraActive) {
      cameraBtn.innerHTML = '📸';
      cameraBtn.classList.add('listening-animation');
      statusText.innerHTML = '🔴 <strong>CAMERA ACTIVE...</strong><br>Look at the camera for face detection';
      statusText.style.color = '#ef4444';

      if (videoContainer) {
        videoContainer.style.display = 'block';
      }
    } else {
      cameraBtn.innerHTML = '📷';
      cameraBtn.classList.remove('listening-animation');
      statusText.innerHTML = '👆 Click camera to start face recognition attendance';
      statusText.style.color = window.elementSdk.config.text_color || defaultConfig.text_color;
      statusText.style.opacity = '0.7';

      if (videoContainer) {
        videoContainer.style.display = 'none';
      }
    }
  }
}

// Show camera permission help
function showCameraPermissionHelp() {
  const config = window.elementSdk.config;
  const fontSize = config.font_size || defaultConfig.font_size;

  // Create modal overlay
  const modal = document.createElement('div');
  modal.id = 'permissionModal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 2000;
    padding: 1rem;
  `;

  modal.innerHTML = `
    <div style="background-color: ${config.card_color || defaultConfig.card_color}; border-radius: 0.75rem; padding: 2rem; max-width: 500px; width: 100%; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.3);">
      <h3 style="font-size: ${fontSize * 1.5}px; font-weight: bold; color: ${config.text_color || defaultConfig.text_color}; margin-bottom: 1rem;">
        📷 Camera Permission Required
      </h3>
      <p style="font-size: ${fontSize}px; color: ${config.text_color || defaultConfig.text_color}; margin-bottom: 1.5rem; line-height: 1.6;">
        To use face recognition attendance, you need to allow camera access. Here's how:
      </p>
      
      <div style="background-color: ${config.background_color || defaultConfig.background_color}; padding: 1.5rem; border-radius: 0.5rem; margin-bottom: 1.5rem;">
        <h4 style="font-size: ${fontSize * 0.875}px; font-weight: 600; color: ${config.text_color || defaultConfig.text_color}; margin-bottom: 1rem;">
          📌 Chrome / Edge:
        </h4>
        <ol style="font-size: ${fontSize * 0.875}px; color: ${config.text_color || defaultConfig.text_color}; line-height: 1.8; padding-left: 1.5rem; margin-bottom: 1.5rem;">
          <li>Click the 🔒 lock icon or 📷 camera icon in the address bar</li>
          <li>Select "Allow" for camera</li>
          <li>Refresh the page and try again</li>
        </ol>
        
        <h4 style="font-size: ${fontSize * 0.875}px; font-weight: 600; color: ${config.text_color || defaultConfig.text_color}; margin-bottom: 1rem;">
          📌 Safari:
        </h4>
        <ol style="font-size: ${fontSize * 0.875}px; color: ${config.text_color || defaultConfig.text_color}; line-height: 1.8; padding-left: 1.5rem; margin-bottom: 1.5rem;">
          <li>Go to Safari menu → Settings → Websites</li>
          <li>Click "Camera" in the left sidebar</li>
          <li>Set this website to "Allow"</li>
          <li>Refresh the page</li>
        </ol>
        
        <h4 style="font-size: ${fontSize * 0.875}px; font-weight: 600; color: ${config.text_color || defaultConfig.text_color}; margin-bottom: 1rem;">
          📌 Firefox:
        </h4>
        <ol style="font-size: ${fontSize * 0.875}px; color: ${config.text_color || defaultConfig.text_color}; line-height: 1.8; padding-left: 1.5rem;">
          <li>Click the 🔒 lock icon in the address bar</li>
          <li>Click the arrow next to "Blocked" permissions</li>
          <li>Enable camera and refresh</li>
        </ol>
      </div>
      
      <button onclick="closePermissionModal()" style="width: 100%; padding: 0.75rem; background-color: ${config.primary_color || defaultConfig.primary_color}; color: white; border-radius: 0.5rem; font-size: ${fontSize}px; font-weight: 600; border: none; cursor: pointer;">
        Got It!
      </button>
    </div>
  `;

  document.body.appendChild(modal);

  // Close on background click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closePermissionModal();
    }
  });
}

// Close permission modal
window.closePermissionModal = function () {
  const modal = document.getElementById('permissionModal');
  if (modal) {
    modal.remove();
  }
};

// Login screen (Redesigned)
function renderLogin() {
  const config = window.elementSdk.config;
  const customFont = config.font_family || defaultConfig.font_family;
  const baseFontStack = 'system-ui, -apple-system, sans-serif';

  const app = document.getElementById('app');
  app.className = "w-full h-full overflow-hidden mesh-bg font-sans";
  app.style.fontFamily = `${customFont}, ${baseFontStack}`;

  app.innerHTML = `
    <div class="w-full h-full flex items-center justify-center relative overflow-hidden">
      
      <!-- Top Right Auth Buttons -->
      <div class="absolute top-6 right-6 z-20 flex gap-4">
        <button onclick="renderLogin()" class="px-6 py-2 bg-white/20 hover:bg-white/30 backdrop-blur-md rounded-full text-white font-bold transition border border-white/20">Login</button>
        <button onclick="renderRegistration()" class="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-full shadow-lg transition transform hover:-translate-y-0.5">Sign Up</button>
      </div>

      <!-- Background Decorative Elements -->
      <div class="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-purple-400 rounded-full blur-[100px] opacity-30 animate-float"></div>
      <div class="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-400 rounded-full blur-[100px] opacity-30 animate-float" style="animation-delay: -2s;"></div>

      <!-- Glass Login Card -->
      <div class="glass-card rounded-2xl p-8 w-full max-w-md mx-4 relative z-10 fade-in-up">
        <div class="text-center mb-8">
          <div class="w-16 h-16 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl mx-auto mb-4 flex items-center justify-center shadow-lg text-white text-2xl font-bold">
            🎓
          </div>
          <h1 class="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-purple-600 mb-2">
            ${config.system_title || defaultConfig.system_title}
          </h1>
          <p class="text-gray-500 font-medium">
            ${config.institution_name || defaultConfig.institution_name}
          </p>
        </div>

        <form id="loginForm" class="space-y-5">
          <div class="space-y-1">
            <label for="username" class="text-sm font-semibold text-gray-700 ml-1">
              Student Name / Registration No.
            </label>
            <input type="text" id="username" required placeholder="Ex: B.Mahendra or 23G31A0509"
              class="input-modern w-full px-4 py-3 rounded-xl text-gray-800 placeholder-gray-400">
          </div>

          <div class="space-y-1">
            <label for="password" class="text-sm font-semibold text-gray-700 ml-1">
              Password
            </label>
            <input type="password" id="password" required placeholder="••••••••"
              class="input-modern w-full px-4 py-3 rounded-xl text-gray-800 placeholder-gray-400">
          </div>

          <div class="space-y-1">
            <label for="role" class="text-sm font-semibold text-gray-700 ml-1">
              Role
            </label>
            <div class="relative">
              <select id="role" required
                class="input-modern w-full px-4 py-3 rounded-xl text-gray-800 appearance-none bg-white cursor-pointer">
                <option value="student">Student</option>
                <option value="teacher">Teacher</option>
                <option value="admin">Admin</option>
              </select>
              <div class="absolute right-4 top-1/2 transform -translate-y-1/2 pointer-events-none text-gray-500">▼      </div>
    </div>
          </div>

          <button type="submit" id="loginBtn"
            class="btn-primary w-full py-3.5 rounded-xl font-bold text-lg shadow-lg shadow-indigo-500/30 mt-4">
            Sign In
          </button>

          <div id="loginError" class="hidden p-3 rounded-lg bg-red-50 text-red-600 text-sm font-medium text-center border border-red-100 animate-pulse"></div>
        
          <div class="text-center mt-6 pt-4 border-t border-slate-100">
            <button type="button" onclick="renderRegistration()" class="text-indigo-600 font-bold hover:underline text-sm">
              Create account with registration
            </button>
          </div>
        </form>
      </div>
    </div>
      `;

  document.getElementById('loginForm').addEventListener('submit', handleLogin);
}

// Render Registration Screen
window.renderRegistration = function () {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="w-full h-full flex items-center justify-center relative overflow-hidden mesh-bg font-sans">
       <!-- Top Right Auth Buttons -->
      <div class="absolute top-6 right-6 z-20 flex gap-4">
        <button onclick="renderLogin()" class="px-6 py-2 bg-white/20 hover:bg-white/30 backdrop-blur-md rounded-full text-white font-bold transition border border-white/20">Login</button>
      </div>

      <div class="glass-card rounded-2xl p-8 w-full max-w-xl mx-4 relative z-10 fade-in-up my-4 overflow-y-auto max-h-[90vh]">
         <div class="text-center mb-6">
           <h2 class="text-2xl font-bold text-slate-800">Student Registration</h2>
           <p class="text-slate-500 text-sm">Create your account to access the portal</p>
         </div>

         <form id="regForm" class="space-y-4">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
               <div>
                  <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Full Name</label>
                  <input type="text" id="regName" required placeholder="e.g. U.Bheemesh" class="input-modern w-full px-4 py-2 rounded-xl">
               </div>
               <div>
                  <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Registration Number</label>
                  <input type="text" id="regNo" required placeholder="e.g. 23G31A05B2" class="input-modern w-full px-4 py-2 rounded-xl" onchange="parseRegDetails(this.value)">
                     </div>
    </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
               <div>
                 <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Branch</label>
                 <input type="text" id="regBranch" readonly class="input-modern w-full px-4 py-2 rounded-xl bg-slate-100 text-slate-600 cursor-not-allowed">
               </div>
               <div>
                 <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Year</label>
                 <input type="text" id="regYear" readonly class="input-modern w-full px-4 py-2 rounded-xl bg-slate-100 text-slate-600 cursor-not-allowed">
                    </div>
    </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
               <div>
                 <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Semester</label>
                 <select id="regSem" class="input-modern w-full px-4 py-2 rounded-xl">
                    <option value="I">I</option>
                    <option value="II">II</option>
                    <option value="III">III</option>
                 </select>
               </div>
               <div>
                 <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Mobile Number</label>
                 <input type="tel" id="regMobile" required placeholder="e.g. 9848XXXXXX" class="input-modern w-full px-4 py-2 rounded-xl">
                    </div>
    </div>

            <div>
               <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Email</label>
               <input type="email" id="regEmail" required placeholder="student@example.com" class="input-modern w-full px-4 py-2 rounded-xl">
            </div>

            <div>
               <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Password</label>
               <input type="password" id="regPass" required class="input-modern w-full px-4 py-2 rounded-xl">
            </div>

            <button type="submit" class="w-full py-3 bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-bold rounded-xl shadow-lg mt-2">Register</button>
         </form>
      </div>
    </div>
  `;

  document.getElementById('regForm').addEventListener('submit', handleRegistration);
}

// Parse Registration Logic
window.parseRegDetails = function (reg) {
  reg = reg.toUpperCase().trim();
  const yearCode = reg.substring(0, 2); // 23
  const branchCode = reg.substring(6, 8); // 05, 13 etc

  let branch = "Unknown";
  if (branchCode === "05") branch = "CSE";
  else if (branchCode === "04") branch = "ECE";
  else if (branchCode === "13") branch = "CAI";
  else if (branchCode === "31") branch = "CAI"; // As per request
  else if (branchCode === "32") branch = "CSD";

  // Logic for Year
  let year = "Unknown";
  // Assuming current academic year relative to 23
  // 23 batch in 2026? 
  // User input says "Year: III" for 23 batch. So let's stick to that map or just default to III for now based on user data.
  // Actually let's try to be smart but safe.
  if (yearCode === '23') year = "III";
  if (yearCode === '24') year = "II";
  if (yearCode === '25') year = "I";

  document.getElementById('regBranch').value = branch;
  document.getElementById('regYear').value = year;
}

// Handle Registration
async function handleRegistration(e) {
  e.preventDefault();
  const name = document.getElementById('regName').value;
  const regNo = document.getElementById('regNo').value.toUpperCase();
  const branch = document.getElementById('regBranch').value;
  const year = document.getElementById('regYear').value;
  const sem = document.getElementById('regSem').value;
  const mobile = document.getElementById('regMobile').value;
  const email = document.getElementById('regEmail').value;
  const password = document.getElementById('regPass').value;

  // Save to demoData memory (mock DB) - In real app, this goes to Firestore
  demoUsers[regNo] = {
    name,
    registration_no: regNo,
    branch,
    year: year,
    mobile_number: mobile,
    role: 'student',
    email: email,
    sem: sem
  };

  // Also save via SDK to persist if connected
  await window.dataSdk.createUser({
    name, registration_no: regNo, branch, year, mobile_number: mobile, role: 'student', email
  });

  showNotification("Registration Successful! Please Login.", "success");
  setTimeout(() => renderLogin(), 1500);
}


// Handle login
async function handleLogin(e) {
  e.preventDefault();

  const inputId = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const role = document.getElementById('role').value;
  const errorDiv = document.getElementById('loginError');
  const loginBtn = document.getElementById('loginBtn');

  errorDiv.style.display = 'none';
  loginBtn.disabled = true;
  loginBtn.innerHTML = '<div class="spinner" style="margin: 0 auto;"></div>';

  await new Promise(resolve => setTimeout(resolve, 800));

  // Authentication Logic (Enhanced for Name/RegNo)
  let foundUser = null;

  // 1. Try Direct Key Lookup (RegNo)
  if (demoUsers[inputId.toUpperCase()]) {
    foundUser = demoUsers[inputId.toUpperCase()];
  }

  // 2. Try RegNo Search (Case Insensitive)
  if (!foundUser) {
    foundUser = Object.values(demoUsers).find(u => u.registration_no && u.registration_no.toLowerCase() === inputId.toLowerCase());
  }

  // 3. Try Name Search
  if (!foundUser) {
    foundUser = Object.values(demoUsers).find(u => u.name && u.name.toLowerCase() === inputId.toLowerCase());
  }

  // 4. Fallback to Email (for Admins)
  if (!foundUser) {
    foundUser = Object.values(demoUsers).find(u => u.email && u.email.toLowerCase() === inputId.toLowerCase());
  }

  if (!foundUser) {
    errorDiv.textContent = "User not found. Please check your credentials.";
    errorDiv.style.display = 'block';
    loginBtn.disabled = false;
    loginBtn.textContent = 'Sign In';
    return;
  }

  if (foundUser.role !== role) {
    errorDiv.textContent = `Role mismatch. This user is a ${foundUser.role}.`;
    errorDiv.style.display = 'block';
    loginBtn.disabled = false;
    loginBtn.textContent = 'Sign In';
    return;
  }

  // Success
  currentUser = { ...foundUser, uid: foundUser.registration_no };
  renderDashboard();
}

// Render dashboard based on role
function renderDashboard() {
  if (currentUser.role === 'student') {
    renderStudentDashboard();
  } else if (currentUser.role === 'teacher') {
    renderTeacherDashboard();
  } else if (currentUser.role === 'admin') {
    renderAdminDashboard();
  }
}

// Toggle camera
window.toggleCamera = function () {
  if (isCameraActive) {
    stopCamera();
  } else {
    startCamera();
  }
};

// Logout function
window.logout = function () {
  if (isCameraActive) {
    stopCamera();
  }
  currentUser = null;
  renderLogin();
};

// --- DASHBOARD IMPLEMENTATIONS (REDESIGNED) ---

function renderStudentDashboard() {
  const app = document.getElementById('app');
  app.className = "w-full h-full flex overflow-hidden mesh-bg font-sans";

  const views = {
    'home': renderStudentHome,
    'advisor': renderAIAdvisor,
    'subjects': renderSemesterSubjects,
    'skills': renderSkillsTracker,
    'faceId': renderFaceRegistration
  };

  const navItems = [
    { id: 'home', label: 'Dashboard', icon: '🏠' },
    { id: 'advisor', label: 'AI Advisor', icon: '🤖' },
    { id: 'subjects', label: 'Semester Subjects', icon: '📚' },
    { id: 'skills', label: 'Skill Tracker', icon: '🎯' },
    { id: 'faceId', label: 'Face ID', icon: '👤' }
  ];

  const renderFn = views[currentStudentView] || renderStudentHome;

  app.innerHTML = `
    <!-- Sidebar -->
    <aside class="w-20 lg:w-64 h-full bg-white/80 backdrop-blur-xl border-r border-slate-200 flex flex-col items-center lg:items-start p-4 lg:p-6 transition-all duration-300 z-20">
      <div class="mb-10 flex items-center gap-3 px-2">
        <div class="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white text-xl font-bold shadow-lg shadow-indigo-200">🎓</div>
        <span class="text-xl font-bold text-slate-800 hidden lg:block tracking-tight">SmartPort</span>
      </div>

      <nav class="flex-1 w-full space-y-2">
        ${navItems.map(item => `
          <button onclick="setStudentView('${item.id}')" 
            class="w-full flex items-center gap-4 p-3 lg:px-4 rounded-2xl transition-all duration-200 group
            ${currentStudentView === item.id ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'}">
            <span class="text-2xl lg:text-xl group-hover:scale-110 transition-transform">${item.icon}</span>
            <span class="font-bold hidden lg:block">${item.label}</span>
          </button>
        `).join('')}
      </nav>

      <div class="mt-auto w-full pt-6 border-t border-slate-100">
        <button onclick="logout()" class="w-full flex items-center gap-4 p-3 lg:px-4 rounded-2xl text-rose-500 hover:bg-rose-50 transition-all group">
          <span class="text-2xl lg:text-xl group-hover:rotate-12 transition-transform">🚪</span>
          <span class="font-bold hidden lg:block">Logout</span>
        </button>
      </div>
    </aside>

    <!-- Main Content Area -->
    <main class="flex-1 h-full overflow-y-auto relative">
      <div class="p-6 md:p-10 max-w-7xlmx-auto">
        <header class="flex flex-col md:flex-row justify-between items-start md:items-center mb-10 fade-in-up">
          <div>
            <h1 class="text-3xl lg:text-4xl font-extrabold text-slate-900 tracking-tight mb-1">
              ${currentStudentView === 'home' ? 'Student Dashboard' : getViewTitle(currentStudentView)}
            </h1>
            <p class="text-slate-500 font-medium">
              ${currentStudentView === 'home' ? `Welcome back, ${currentUser.name}! ✨` : `Personalized tools for your success`}
            </p>
          </div>

          <div class="flex flex-col items-end mr-4 hidden md:block">
            <div id="headerDate" class="text-xs font-bold text-slate-500 uppercase tracking-wider"></div>
            <div id="headerTime" class="text-xl font-bold text-indigo-600 leading-none"></div>
            <div id="holidayBadge" class="hidden text-[10px] font-bold text-white bg-rose-500 px-2 py-0.5 rounded-full mt-1"></div>
          </div>

          <div class="mt-4 md:mt-0 flex items-center gap-3 p-1 bg-white/50 backdrop-blur rounded-2xl border border-white/60 shadow-sm">
            <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-white font-bold text-xs">
              ${currentUser.name.split(' ').map(n => n[0]).join('')}
            </div>
            <div class="pr-3 hidden sm:block">
              <div class="text-xs font-bold text-slate-800 leading-tight">${currentUser.name}</div>
              <div class="text-[10px] text-slate-500 font-medium uppercase tracking-wider">${currentUser.registration_no}      </div>
    </div>
          </div>
        </header>

        <div id="studentContent" class="fade-in">
          ${renderFn()}
        </div>
      </div>
    </main>
  `;

  startClock();

  // Face ID status comes from the cloud DB (an inline <script> injected via
  // innerHTML would never execute)
  checkFaceIdStatus(currentUser.registration_no);
}

// Async status check for the dashboard "Face ID Status" card
async function checkFaceIdStatus(registrationNo) {
  try {
    const descriptors = await window.dataSdk.getAllFaceDescriptors();
    const isRegistered = descriptors.some(d => d.student_id === registrationNo);
    const badge = document.getElementById('faceStatusBadge');
    if (badge) {
      badge.innerHTML = isRegistered
        ? '<span class="flex items-center gap-2 text-emerald-600 font-bold text-sm"><span>✅</span> REGISTERED</span>'
        : '<span class="flex items-center gap-2 text-rose-500 font-bold text-sm"><span>❌</span> NOT REGISTERED</span>';
    }
  } catch (err) {
    console.warn('Could not check Face ID status:', err);
  }
}

// Start Clock and Date Update
function startClock() {
  function update() {
    const now = new Date();
    const dateEl = document.getElementById('headerDate');
    const timeEl = document.getElementById('headerTime');
    const badgeEl = document.getElementById('holidayBadge');

    if (dateEl && timeEl) {
      dateEl.textContent = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      timeEl.textContent = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    }

    // Check Holiday Status for UI
    if (badgeEl) {
      const status = checkAttendanceAllowed();
      if (!status.allowed) {
        badgeEl.textContent = status.reason.includes('Sunday') ? 'SUNDAY' : 'HOLIDAY';
        badgeEl.classList.remove('hidden');
      } else {
        badgeEl.classList.add('hidden');
      }
    }
  }

  update(); // Initial call
  if (clockInterval) clearInterval(clockInterval); // avoid stacked intervals across re-renders
  clockInterval = setInterval(update, 1000);
}

function getViewTitle(view) {
  const titles = {
    'advisor': 'AI-Powered Advisor',
    'subjects': 'Semester-wise Subjects',
    'skills': 'Skills & Competency Tracker',
    'faceId': 'Face ID Registration'
  };
  return titles[view] || '';
}

window.setStudentView = function (view) {
  currentStudentView = view;
  renderStudentDashboard();
};

function renderStudentHome() {
  const config = window.elementSdk.config;

  // Calculate Stats
  const myAttendance = allData.filter(d =>
    d.type === 'attendance' && d.student_id === currentUser.registration_no
  );
  const totalClasses = 45;
  const presentCount = myAttendance.length;
  const percentage = Math.round((presentCount / totalClasses) * 100);
  const ahs = calculateAHS(percentage, 8.5, 2);

  return `
    <!-- Stats Grid -->
    <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-10">
      <!-- Attendance Card -->
      <div onclick="showNotification('Attendance details coming soon!', 'info')" class="glass-card rounded-3xl p-6 relative overflow-hidden group cursor-pointer hover:shadow-xl transition-all">
        <h3 class="font-bold text-slate-500 mb-2 text-[10px] uppercase tracking-wider">Attendance</h3>
        <div class="flex items-baseline mb-4">
          <span class="text-4xl font-black text-indigo-600">${percentage}%</span>
        </div>
        <div class="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
          <div class="bg-gradient-to-r from-indigo-500 to-purple-500 h-full rounded-full" style="width: ${percentage}%"></div>
        </div>
      </div>

      <!-- Health Score -->
      <div class="glass-card rounded-3xl p-6 relative overflow-hidden group">
        <h3 class="font-bold text-slate-500 mb-2 text-[10px] uppercase tracking-wider">Academic Health</h3>
        <div class="flex items-center justify-between">
          <div>
            <div class="text-3xl font-black text-slate-800">${ahs.score}</div>
            <div class="text-[10px] font-bold ${ahs.status === 'Good' ? 'text-green-600' : 'text-amber-600'} uppercase">
              ${ahs.status}
            </div>
          </div>
          <div class="text-2xl">${ahs.status === 'Good' ? '🏆' : '⚠️'}</div>
        </div>
      </div>

      <!-- Face ID Status -->
      <div onclick="setStudentView('faceId')" class="glass-card rounded-3xl p-6 border-2 border-indigo-50 hover:border-indigo-400 transition-all cursor-pointer group relative overflow-hidden">
        <h3 class="font-bold text-slate-500 mb-2 text-[10px] uppercase tracking-wider">Face ID Status</h3>
        <div id="faceStatusBadge" class="flex items-center gap-2">
           <div class="spinner-sm"></div>
           <span class="text-xs text-slate-400">Checking...</span>
        </div>
      </div>

      <!-- Course Info -->
      <div class="glass-card rounded-3xl p-6 bg-indigo-600 text-white relative overflow-hidden">
        <h3 class="font-medium text-indigo-100 text-[10px] uppercase tracking-wider mb-2">My Program</h3>
        <div class="text-xl font-bold truncate">${currentUser.branch || 'B.Tech'}</div>
        <div class="text-xs opacity-80">${currentUser.year} Year</div>
      </div>
    </div>

    <!-- Enhanced Features Menu -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-8 mb-10">
      <div onclick="setStudentView('advisor')" class="glass-card p-6 rounded-3xl border-2 border-transparent hover:border-indigo-500 hover:shadow-xl transition-all cursor-pointer group">
        <div class="w-14 h-14 bg-indigo-100 text-indigo-600 rounded-2xl flex items-center justify-center text-3xl mb-4 group-hover:scale-110 transition-transform">🤖</div>
        <h3 class="font-bold text-xl text-slate-800 mb-2">AI Advisor</h3>
        <p class="text-sm text-slate-500">Personalized course & internship suggestions.</p>
      </div>

      <div onclick="setStudentView('subjects')" class="glass-card p-6 rounded-3xl border-2 border-transparent hover:border-purple-500 hover:shadow-xl transition-all cursor-pointer group">
        <div class="w-14 h-14 bg-purple-100 text-purple-600 rounded-2xl flex items-center justify-center text-3xl mb-4 group-hover:scale-110 transition-transform">📚</div>
        <h3 class="font-bold text-xl text-slate-800 mb-2">Semester Subjects</h3>
        <p class="text-sm text-slate-500">Track subjects across all semesters.</p>
      </div>

      <div onclick="setStudentView('skills')" class="glass-card p-6 rounded-3xl border-2 border-transparent hover:border-amber-500 hover:shadow-xl transition-all cursor-pointer group">
        <div class="w-14 h-14 bg-amber-100 text-amber-600 rounded-2xl flex items-center justify-center text-3xl mb-4 group-hover:scale-110 transition-transform">🎯</div>
        <h3 class="font-bold text-xl text-slate-800 mb-2">Skill Tracker</h3>
        <p class="text-sm text-slate-500">Mastery of soft & hard skills with certs.</p>
      </div>
    </div>

    <!-- Recent Activity -->
    <div class="glass-card rounded-3xl p-8">
      <h3 class="font-bold text-xl text-slate-800 mb-6">Recent Activity</h3>
      <div class="space-y-3">
        ${myAttendance.slice(0, 3).map((record, i) => `
          <div class="flex items-center justify-between p-4 bg-white/50 border border-white rounded-2xl hover:shadow-md transition-shadow">
            <div class="flex items-center gap-4">
              <div class="w-12 h-12 rounded-2xl flex items-center justify-center text-xl bg-indigo-100 text-indigo-600">
                 ${record.auto_marked ? '🤖' : '✍️'}
              </div>
              <div>
                 <p class="font-bold text-slate-800">Attendance Log</p>
                 <p class="text-sm text-slate-500">${record.date} • ${record.auto_marked ? 'AI Face Scan' : 'Manual'}</p>
                    </div>
    </div>
            <span class="text-emerald-600 font-bold">Present</span>
          </div>
        `).join('') || '<p class="text-slate-400">No recent activity.</p>'}
      </div>
    </div>
  `;
}

function renderAIAdvisor() {
  return `<div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
      <div class="glass-card p-8 rounded-3xl">
        <div class="flex items-center gap-4 mb-6">
          <div class="w-12 h-12 bg-indigo-500 text-white rounded-2xl flex items-center justify-center text-2xl">💡</div>
          <h3 class="font-bold text-2xl">Recommended Courses</h3>
        </div>
        <div class="space-y-4">
          <div class="p-4 bg-white/60 rounded-2xl border border-indigo-100">
            <h4 class="font-bold text-indigo-700">Advanced Machine Learning</h4>
            <p class="text-sm text-slate-600 mt-1">Based on your interest in CSE and your A+ in Calculus.</p>
            <div class="mt-3 flex gap-2">
              <span class="px-3 py-1 bg-indigo-50 text-indigo-600 rounded-lg text-xs font-bold">Recommended</span>
              <button class="ml-auto text-indigo-600 font-bold text-sm">Enroll →</button>
            </div>
          </div>
          <div class="p-4 bg-white/60 rounded-2xl border border-slate-100">
            <h4 class="font-bold text-slate-800">Web Design Patterns</h4>
            <p class="text-sm text-slate-600 mt-1">Complements your current Web Technologies course.</p>
            <div class="mt-3 flex gap-2">
              <span class="px-3 py-1 bg-slate-100 text-slate-600 rounded-lg text-xs font-bold">Elective</span>
              <button class="ml-auto text-indigo-600 font-bold text-sm">Enroll →</button>
            </div>
          </div>
        </div>
      </div>

      <div class="glass-card p-8 rounded-3xl">
        <div class="flex items-center gap-4 mb-6">
          <div class="w-12 h-12 bg-purple-500 text-white rounded-2xl flex items-center justify-center text-2xl">🚀</div>
          <h3 class="font-bold text-2xl">Internship Opportunities</h3>
        </div>
        <div class="space-y-4">
          <div class="p-4 bg-white/60 rounded-2xl border border-purple-100">
            <h4 class="font-bold text-purple-700">Software Engineer Intern @ Google</h4>
            <p class="text-sm text-slate-600 mt-1">Application deadline in 12 days. Your profile is a 92% match!</p>
            <button class="mt-3 w-full py-2 bg-purple-600 text-white rounded-xl font-bold text-sm">Apply Now</button>
          </div>
          <div class="p-4 bg-white/60 rounded-2xl border border-slate-100">
            <h4 class="font-bold text-slate-800">UI/UX Research Intern @ Microsoft</h4>
            <p class="text-sm text-slate-600 mt-1">Ideal for students with strong communication skills.</p>
            <button class="mt-3 w-full py-2 bg-slate-800 text-white rounded-xl font-bold text-sm">View Details</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderSemesterSubjects() {
  const branch = currentUser.branch || "CSE"; // Default to CSE if unknown

  const syllabusData = {
    "CSE": {
      1: {
        subjects: [
          { name: "Chemistry", credits: 4, grade: "A", status: "Pass" },
          { name: "BCME", credits: 3, grade: "B+", status: "Pass" },
          { name: "LAC", credits: 3, grade: "A", status: "Pass" },
          { name: "English", credits: 3, grade: "A+", status: "Pass" },
          { name: "C Language", credits: 3, grade: "O", status: "Pass" }
        ],
        labs: [
          { name: "C Programming Lab", credits: 1.5, grade: "O", status: "Pass" },
          { name: "Chemistry Lab", credits: 1.5, grade: "A", status: "Pass" },
          { name: "Engineering Workshop", credits: 1.5, grade: "A+", status: "Pass" },
          { name: "English Lab", credits: 1.5, grade: "O", status: "Pass" },
          { name: "Sports and Yoga", credits: 0, grade: "P", status: "Pass" }
        ]
      },
      2: {
        subjects: [
          { name: "Physics", credits: 4, grade: "-", status: "Pending" },
          { name: "BEEE", credits: 3, grade: "-", status: "Pending" },
          { name: "DEVC", credits: 3, grade: "-", status: "Pending" },
          { name: "Data Structure", credits: 3, grade: "-", status: "Pending" },
          { name: "Engineering Graphics", credits: 3, grade: "-", status: "Pending" }
        ],
        labs: [
          { name: "Engineering Graphics Lab", credits: 1.5, grade: "-", status: "Pending" },
          { name: "Data Structure Lab", credits: 1.5, grade: "-", status: "Pending" },
          { name: "BEEE Lab", credits: 1.5, grade: "-", status: "Pending" },
          { name: "Physics Lab", credits: 1.5, grade: "-", status: "Pending" },
          { name: "Information Technology", credits: 1.5, grade: "-", status: "Pending" }
        ]
      },
      3: {
        subjects: [
          { name: "Java Programming", credits: 3, grade: "A", status: "Pass" },
          { name: "DLCO", credits: 3, grade: "B+", status: "Pass" },
          { name: "DMGT", credits: 3, grade: "A", status: "Pass" },
          { name: "ADSA", credits: 3, grade: "A", status: "Pass" },
          { name: "UHV", credits: 2, grade: "O", status: "Pass" },
          { name: "Environmental Science", credits: 2, grade: "O", status: "Pass" }
        ],
        labs: [
          { name: "Python Lab", credits: 1.5, grade: "O", status: "Pass" },
          { name: "ADSA Lab", credits: 1.5, grade: "A", status: "Pass" },
          { name: "Java Programming Lab", credits: 1.5, grade: "A+", status: "Pass" }
        ]
      },
      4: {
        subjects: [
          { name: "OS", credits: 3, grade: "-", status: "Pending" },
          { name: "DBMS", credits: 3, grade: "-", status: "Pending" },
          { name: "MEFA", credits: 3, grade: "-", status: "Pending" },
          { name: "DTI", credits: 3, grade: "-", status: "Pending" },
          { name: "P&S", credits: 3, grade: "-", status: "Pending" },
          { name: "SE", credits: 3, grade: "-", status: "Pending" }
        ],
        labs: [
          { name: "DBMS Lab", credits: 1.5, grade: "-", status: "Pending" },
          { name: "OS Lab", credits: 1.5, grade: "-", status: "Pending" },
          { name: "FSD1 Lab", credits: 1.5, grade: "-", status: "Pending" }
        ]
      },
      5: {
        subjects: [
          { name: "CN", credits: 3, grade: "A", status: "Pass" },
          { name: "AI", credits: 3, grade: "A", status: "Pass" },
          { name: "ATCD", credits: 3, grade: "B+", status: "Pass" },
          { name: "IQTA", credits: 2, grade: "O", status: "Pass" },
          { name: "DWDM", credits: 3, grade: "A", status: "Pass" },
          { name: "ESPS", credits: 3, grade: "A", status: "Pass" }
        ],
        labs: [
          { name: "CN Lab", credits: 1.5, grade: "O", status: "Pass" },
          { name: "AI Lab", credits: 1.5, grade: "A+", status: "Pass" },
          { name: "FSD2 Lab", credits: 1.5, grade: "A", status: "Pass" },
          { name: "Tinkering Lab", credits: 1.5, grade: "O", status: "Pass" }
        ]
      },
      6: {
        subjects: [
          { name: "CNS", credits: 3, grade: "-", status: "Pending" },
          { name: "CC", credits: 3, grade: "-", status: "Pending" },
          { name: "CS", credits: 3, grade: "-", status: "Pending" },
          { name: "SPM", credits: 3, grade: "-", status: "Pending" },
          { name: "ML", credits: 3, grade: "-", status: "Pending" },
          { name: "RES", credits: 3, grade: "-", status: "Pending" }
        ],
        labs: [
          { name: "CNS Lab", credits: 1.5, grade: "-", status: "Pending" },
          { name: "ML Lab", credits: 1.5, grade: "-", status: "Pending" },
          { name: "SS Lab", credits: 1.5, grade: "-", status: "Pending" }
        ]
      }
    },
    // CAI & CSD Shared
    "CAI": {
      1: {
        subjects: [
          { name: "Physics", credits: 4, grade: "A", status: "Pass" },
          { name: "BEEE", credits: 3, grade: "B+", status: "Pass" },
          { name: "LAC", credits: 3, grade: "A", status: "Pass" },
          { name: "Engineering Graphics", credits: 3, grade: "A", status: "Pass" },
          { name: "C Language", credits: 3, grade: "O", status: "Pass" }
        ],
        labs: [
          { name: "C Programming Lab", credits: 1.5, grade: "O", status: "Pass" },
          { name: "Physics Lab", credits: 1.5, grade: "A", status: "Pass" },
          { name: "Information Technology", credits: 1.5, grade: "A+", status: "Pass" },
          { name: "Engineering Graphics Lab", credits: 1.5, grade: "A", status: "Pass" },
          { name: "Sports and Yoga", credits: 0, grade: "P", status: "Pass" }
        ]
      },
      2: {
        subjects: [
          { name: "Chemistry", credits: 4, grade: "-", status: "Pending" },
          { name: "BCAM", credits: 3, grade: "-", status: "Pending" },
          { name: "DEVC", credits: 3, grade: "-", status: "Pending" },
          { name: "Data Structure", credits: 3, grade: "-", status: "Pending" },
          { name: "English", credits: 3, grade: "-", status: "Pending" }
        ],
        labs: [
          { name: "English Lab", credits: 1.5, grade: "-", status: "Pending" },
          { name: "Data Structure Lab", credits: 1.5, grade: "-", status: "Pending" },
          { name: "BEEE Lab", credits: 1.5, grade: "-", status: "Pending" },
          { name: "Physics Lab", credits: 1.5, grade: "-", status: "Pending" },
          { name: "Engineering Workshop", credits: 1.5, grade: "-", status: "Pending" }
        ]
      },
      3: {
        subjects: [
          { name: "DMGT", credits: 3, grade: "A", status: "Pass" },
          { name: "ADSA", credits: 3, grade: "B+", status: "Pass" },
          { name: "Java Programming", credits: 3, grade: "A", status: "Pass" },
          { name: "UHV", credits: 2, grade: "O", status: "Pass" },
          { name: "AI", credits: 3, grade: "A", status: "Pass" },
          { name: "Environmental Science", credits: 2, grade: "O", status: "Pass" }
        ],
        labs: [
          { name: "Java Programming Lab", credits: 1.5, grade: "O", status: "Pass" },
          { name: "ADSA Lab", credits: 1.5, grade: "A", status: "Pass" },
          { name: "Python Lab", credits: 1.5, grade: "A+", status: "Pass" }
        ]
      },
      4: {
        subjects: [
          { name: "DBMS", credits: 3, grade: "-", status: "Pending" },
          { name: "ML", credits: 3, grade: "-", status: "Pending" },
          { name: "DLCO", credits: 3, grade: "-", status: "Pending" },
          { name: "DTI", credits: 3, grade: "-", status: "Pending" },
          { name: "P&S", credits: 3, grade: "-", status: "Pending" },
          { name: "OT", credits: 3, grade: "-", status: "Pending" }
        ],
        labs: [
          { name: "DBMS Lab", credits: 1.5, grade: "-", status: "Pending" },
          { name: "ML Lab", credits: 1.5, grade: "-", status: "Pending" },
          { name: "FSD1 Lab", credits: 1.5, grade: "-", status: "Pending" }
        ]
      },
      5: {
        subjects: [
          { name: "IQTA", credits: 3, grade: "A", status: "Pass" },
          { name: "NLP", credits: 3, grade: "A", status: "Pass" },
          { name: "EDAP", credits: 3, grade: "B+", status: "Pass" },
          { name: "SSP", credits: 3, grade: "O", status: "Pass" },
          { name: "ESPS", credits: 3, grade: "A", status: "Pass" },
          { name: "CV&IP", credits: 3, grade: "A", status: "Pass" }
        ],
        labs: [
          { name: "NLP Lab", credits: 1.5, grade: "O", status: "Pass" },
          { name: "CV&IP Lab", credits: 1.5, grade: "A+", status: "Pass" },
          { name: "FSD2 Lab", credits: 1.5, grade: "A", status: "Pass" }
        ]
      },
      6: {
        subjects: [
          { name: "FSD FOR AI", credits: 3, grade: "-", status: "Pending" },
          { name: "RES", credits: 3, grade: "-", status: "Pending" },
          { name: "BIG Data", credits: 3, grade: "-", status: "Pending" },
          { name: "Block Chain", credits: 3, grade: "-", status: "Pending" },
          { name: "SNA", credits: 3, grade: "-", status: "Pending" },
          { name: "Cloud Computing", credits: 3, grade: "-", status: "Pending" }
        ],
        labs: [
          { name: "CC and BIG DATA Lab", credits: 1.5, grade: "-", status: "Pending" },
          { name: "FSD FOR AI Lab", credits: 1.5, grade: "-", status: "Pending" },
          { name: "SS Lab", credits: 1.5, grade: "-", status: "Pending" }
        ]
      }
    },
    // ECE
    "ECE": {
      1: {
        subjects: [
          { name: "Physics", credits: 4, grade: "A", status: "Pass" },
          { name: "BEEE", credits: 3, grade: "A", status: "Pass" },
          { name: "LAC", credits: 3, grade: "B+", status: "Pass" },
          { name: "Engineering Graphics", credits: 3, grade: "A", status: "Pass" },
          { name: "C Language", credits: 3, grade: "O", status: "Pass" }
        ],
        labs: [
          { name: "C Programming Lab", credits: 1.5, grade: "O", status: "Pass" },
          { name: "Physics Lab", credits: 1.5, grade: "A", status: "Pass" },
          { name: "Information Technology", credits: 1.5, grade: "A+", status: "Pass" },
          { name: "Engineering Graphics Lab", credits: 1.5, grade: "A", status: "Pass" },
          { name: "Sports and Yoga", credits: 0, grade: "P", status: "Pass" }
        ]
      },
      2: {
        subjects: [
          { name: "Chemistry", credits: 4, grade: "-", status: "Pending" },
          { name: "BCAM", credits: 3, grade: "-", status: "Pending" },
          { name: "DEVC", credits: 3, grade: "-", status: "Pending" },
          { name: "Network Analysis", credits: 3, grade: "-", status: "Pending" },
          { name: "English", credits: 3, grade: "-", status: "Pending" }
        ],
        labs: [
          { name: "English Lab", credits: 1.5, grade: "-", status: "Pending" },
          { name: "Network Analysis Lab", credits: 1.5, grade: "-", status: "Pending" },
          { name: "BEEE Lab", credits: 1.5, grade: "-", status: "Pending" },
          { name: "Physics Lab", credits: 1.5, grade: "-", status: "Pending" },
          { name: "Engineering Workshop", credits: 1.5, grade: "-", status: "Pending" }
        ]
      },
      3: {
        subjects: [
          { name: "EDC", credits: 3, grade: "A", status: "Pass" },
          { name: "DCD", credits: 3, grade: "B+", status: "Pass" },
          { name: "SS and SP", credits: 3, grade: "A", status: "Pass" },
          { name: "UHV", credits: 2, grade: "O", status: "Pass" },
          { name: "PCV", credits: 3, grade: "A", status: "Pass" },
          { name: "Environmental Science", credits: 2, grade: "O", status: "Pass" }
        ],
        labs: [
          { name: "EDC Lab", credits: 1.5, grade: "O", status: "Pass" },
          { name: "DCD Lab", credits: 1.5, grade: "A", status: "Pass" },
          { name: "SS and SP Lab", credits: 1.5, grade: "A+", status: "Pass" },
          { name: "Python Lab", credits: 1.5, grade: "O", status: "Pass" }
        ]
      },
      4: {
        subjects: [
          { name: "EWMLT", credits: 3, grade: "-", status: "Pending" },
          { name: "MEFA", credits: 3, grade: "-", status: "Pending" },
          { name: "DTI", credits: 3, grade: "-", status: "Pending" },
          { name: "LCS", credits: 3, grade: "-", status: "Pending" },
          { name: "ECA", credits: 3, grade: "-", status: "Pending" },
          { name: "ADC", credits: 3, grade: "-", status: "Pending" }
        ],
        labs: [
          { name: "ECA Lab", credits: 1.5, grade: "-", status: "Pending" },
          { name: "ADC Lab", credits: 1.5, grade: "-", status: "Pending" },
          { name: "SS Lab", credits: 1.5, grade: "-", status: "Pending" }
        ]
      },
      5: {
        subjects: [
          { name: "AWP", credits: 3, grade: "A", status: "Pass" },
          { name: "MPMC", credits: 3, grade: "A", status: "Pass" },
          { name: "IQTA", credits: 3, grade: "B+", status: "Pass" },
          { name: "Java Programming", credits: 3, grade: "O", status: "Pass" },
          { name: "ADIC", credits: 3, grade: "A", status: "Pass" },
          { name: "CAO", credits: 3, grade: "A", status: "Pass" }
        ],
        labs: [
          { name: "ADIC Lab", credits: 1.5, grade: "O", status: "Pass" },
          { name: "Tinkering Lab", credits: 1.5, grade: "A+", status: "Pass" },
          { name: "MPMC Lab", credits: 1.5, grade: "A", status: "Pass" },
          { name: "PCB Design Prototype Lab", credits: 1.5, grade: "O", status: "Pass" }
        ]
      },
      6: {
        subjects: [
          { name: "SC", credits: 3, grade: "-", status: "Pending" },
          { name: "MOC", credits: 3, grade: "-", status: "Pending" },
          { name: "DSP", credits: 3, grade: "-", status: "Pending" },
          { name: "RES", credits: 3, grade: "-", status: "Pending" },
          { name: "EMI", credits: 3, grade: "-", status: "Pending" },
          { name: "VLSI", credits: 3, grade: "-", status: "Pending" }
        ],
        labs: [
          { name: "MOC Lab", credits: 1.5, grade: "-", status: "Pending" },
          { name: "DSP Lab", credits: 1.5, grade: "-", status: "Pending" },
          { name: "VLSI Lab", credits: 1.5, grade: "-", status: "Pending" },
          { name: "TPIP", credits: 1.5, grade: "-", status: "Pending" }
        ]
      }
    }
  };

  // CSD maps to CAI
  syllabusData["CSD"] = syllabusData["CAI"];

  const data = syllabusData[branch] || syllabusData["CSE"];

  // Logic to determine which semesters to show based on Year
  let semestersToShow = [1, 2];
  const year = currentUser.year;

  if (year === "II") semestersToShow = [1, 2, 3, 4];
  if (year === "III") semestersToShow = [1, 2, 3, 4, 5, 6];
  if (year === "IV") semestersToShow = [1, 2, 3, 4, 5, 6, 7, 8];

  // Helper to render a table row
  const renderRow = (item, index) => `
    <div class="grid grid-cols-12 gap-2 p-3 bg-white/60 rounded-xl items-center text-sm border border-slate-100 hover:bg-white transition-colors">
      <div class="col-span-1 text-slate-400 font-bold text-xs">#${index + 1}</div>
      <div class="col-span-5 font-semibold text-slate-800 truncate" title="${item.name}">${item.name}</div>
      <div class="col-span-2 text-slate-500 text-center font-mono text-xs">${item.credits}</div>
      <div class="col-span-2 text-center">
        <span class="px-2 py-1 rounded-md text-[10px] font-bold uppercase
          ${item.status === 'Pass' ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'}">
          ${item.status}
        </span>
      </div>
      <div class="col-span-2 text-center font-bold text-slate-700">${item.grade}</div>
    </div>
  `;

  // Helper to render table header
  const renderHeader = () => `
    <div class="grid grid-cols-12 gap-2 px-3 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-200 mb-2">
      <div class="col-span-1">No.</div>
      <div class="col-span-5">Subject Name</div>
      <div class="col-span-2 text-center">Credits</div>
      <div class="col-span-2 text-center">Status</div>
      <div class="col-span-2 text-center">Grade</div>
    </div>
  `;

  // Status Helper based on User Rules
  const getSemStatus = (s) => {
    // 2nd Year -> Sem 4 is Current (1,2,3 done)
    if (year === "II") {
      if (s <= 3) return { label: 'Completed', icon: '✅' };
      if (s === 4) return { label: 'Current Session', icon: '⏳' };
    }
    // 3rd Year -> Sem 5 is Current (1,2,3,4 done)
    else if (year === "III") {
      if (s <= 4) return { label: 'Completed', icon: '✅' };
      if (s === 5) return { label: 'Current Session', icon: '⏳' };
    }
    // 4th Year -> Sem 7 is Current (1-6 done)
    else if (year === "IV") {
      if (s <= 6) return { label: 'Completed', icon: '✅' };
      if (s === 7) return { label: 'Current Session', icon: '⏳' };
    }
    // 1st Year -> Sem 2 is Current (1 done)
    else {
      if (s === 1) return { label: 'Completed', icon: '✅' };
      if (s === 2) return { label: 'Current Session', icon: '⏳' };
    }
    return { label: 'Upcoming', icon: '📅' };
  };

  return `
    <div class="space-y-8">
      <div class="flex items-center justify-between mb-4">
        <div>
           <h2 class="text-2xl font-bold text-slate-800">Academic Syllabus</h2>
           <p class="text-slate-500 text-sm">Branch: <span class="font-bold text-indigo-600">${branch}</span> • Year: <span class="font-bold text-indigo-600">${year}</span></p>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
        ${semestersToShow.map(sem => {
    const status = getSemStatus(sem);
    const semData = data[sem];

    if (!semData) return `
             <div class="glass-card p-6 rounded-3xl border border-slate-100 flex items-center justify-center text-slate-400 font-medium italic">
               Syllabus data not available for Semester ${sem}
             </div>`;

    return `
          <div class="glass-card p-0 rounded-3xl border border-slate-100 transition-all hover:shadow-xl overflow-hidden flex flex-col h-full">
            
            <!-- Header -->
            <div class="p-6 pb-4 bg-gradient-to-r from-slate-50 to-white border-b border-slate-100 flex justify-between items-center">
               <div>
                  <h3 class="font-bold text-xl text-indigo-700">Semester ${sem}</h3>
                  <div class="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">
                    ${status.label}
                  </div>
               </div>
               <div class="w-10 h-10 rounded-full bg-white shadow-sm flex items-center justify-center text-lg">
                 ${status.icon}
               </div>
            </div>

            <div class="p-6 space-y-8 flex-1 overflow-y-auto max-h-[600px]">
               
               <!-- Theory Section -->
               <div>
                  <div class="flex items-center gap-2 mb-3">
                    <span class="w-2 h-2 rounded-full bg-indigo-500"></span>
                    <h4 class="text-xs font-bold text-slate-500 uppercase tracking-widest">Theory Subjects</h4>
                  </div>
                  ${renderHeader()}
                  <div class="space-y-1">
                    ${semData.subjects.map((sub, i) => renderRow(sub, i)).join('')}
                  </div>
               </div>

               <!-- Labs Section -->
               <div>
                   <div class="flex items-center gap-2 mb-3">
                    <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
                    <h4 class="text-xs font-bold text-slate-500 uppercase tracking-widest">Laboratory</h4>
                  </div>
                  ${renderHeader()}
                  <div class="space-y-1">
                    ${semData.labs.map((lab, i) => renderRow(lab, i)).join('')}
                  </div>
               </div>

            </div>
          </div>`;
  }).join('')}
      </div>
    </div>
  `;
}

function renderSkillsTracker() {
  const skills = [
    { name: "Programming", level: 85, color: "indigo", projects: 12 },
    { name: "Communication", level: 92, color: "emerald", projects: 8 },
    { name: "Problem Solving", level: 78, color: "amber", projects: 15 },
    { name: "Design Thinking", level: 65, color: "rose", projects: 4 }
  ];

  return `
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
      <div class="glass-card p-8 rounded-3xl">
        <h3 class="font-bold text-2xl mb-8">Skill Proficiency</h3>
        <div class="space-y-8">
          ${skills.map(s => `
            <div>
              <div class="flex justify-between items-center mb-2">
                <span class="font-bold text-slate-700">${s.name}</span>
                <span class="font-bold text-${s.color}-600">${s.level}%</span>
              </div>
              <div class="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
                <div class="bg-${s.color}-500 h-full rounded-full" style="width: ${s.level}%"></div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="glass-card p-8 rounded-3xl">
        <h3 class="font-bold text-2xl mb-6">Certifications & Badges</h3>
        <div class="grid grid-cols-2 gap-4">
          <div class="p-4 bg-white/60 rounded-2xl border border-slate-100 text-center">
            <div class="text-4xl mb-2">⭐</div>
            <h4 class="font-bold text-sm">Python Expert</h4>
            <p class="text-[10px] text-slate-400 mt-1">AWS Certified</p>
          </div>
          <div class="p-4 bg-white/60 rounded-2xl border border-slate-100 text-center">
            <div class="text-4xl mb-2">🎨</div>
            <h4 class="font-bold text-sm">UI Design 101</h4>
            <p class="text-[10px] text-slate-400 mt-1">Google UX Ceritified</p>
          </div>
          <div class="p-4 bg-white/60 rounded-2xl border border-slate-100 text-center">
            <div class="text-4xl mb-2">📊</div>
            <h4 class="font-bold text-sm">Data Viz</h4>
            <p class="text-[10px] text-slate-400 mt-1">Tableau Certified</p>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderFinancialLiteracy() {
  return `
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
      <div class="glass-card p-8 rounded-3xl">
        <h3 class="font-bold text-2xl mb-6 flex items-center gap-3">💰 Monthly Spending</h3>
        <div class="flex items-center justify-between mb-8">
          <div>
            <div class="text-4xl font-black text-slate-800">₹4,250</div>
            <p class="text-sm text-slate-500 font-medium">Spent so far in October</p>
          </div>
          <div class="text-right">
             <div class="text-rose-500 font-bold">+12%</div>
             <p class="text-xs text-slate-400">vs last month</p>
          </div>
        </div>
        
        <div class="space-y-4">
           <div class="flex justify-between items-center p-3 hover:bg-slate-50 rounded-xl transition-colors">
             <div class="flex items-center gap-3">
               <div class="w-10 h-10 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center">🍔</div>
               <span class="font-bold text-slate-700">Food & Dining</span>
             </div>
             <span class="font-bold">₹2,100</span>
           </div>
           <div class="flex justify-between items-center p-3 hover:bg-slate-50 rounded-xl transition-colors">
             <div class="flex items-center gap-3">
               <div class="w-10 h-10 bg-emerald-100 text-emerald-600 rounded-xl flex items-center justify-center">🚌</div>
               <span class="font-bold text-slate-700">Transport</span>
             </div>
             <span class="font-bold">₹850</span>
           </div>
        </div>
      </div>

      <div class="glass-card p-8 rounded-3xl bg-gradient-to-br from-indigo-600 to-indigo-800 text-white">
        <h3 class="font-bold text-xl mb-6">Eligible Scholarships</h3>
        <div class="space-y-4">
          <div class="p-4 bg-white/10 rounded-2xl border border-white/20">
            <h4 class="font-bold">Merit-Based Excellence</h4>
            <p class="text-sm opacity-80 mt-1">For students with CGPA > 9.0. Grant: ₹50,000/yr</p>
            <button class="mt-4 w-full py-2 bg-white text-indigo-600 rounded-xl font-bold text-sm">Apply Link</button>
          </div>
          <div class="p-4 bg-white/10 rounded-2xl border border-white/20">
            <h4 class="font-bold">Tech Innovators Grant</h4>
            <p class="text-sm opacity-80 mt-1">For student project development fund.</p>
            <button class="mt-4 w-full py-2 bg-white text-indigo-600 rounded-xl font-bold text-sm">Read More</button>
          </div>
        </div>
      </div>
    </div>
  `;
}


// --- Teacher Dashboard Helpers ---
function renderTeacherAttendanceLists() {
  const students = Object.values(demoUsers).filter(u => u.role === 'student');
  const today = new Date().toISOString().split('T')[0];

  const presentStudents = students.filter(s =>
    allData.some(d => d.student_id === s.registration_no && d.date === today && d.present)
  );

  const absentStudents = students.filter(s => !presentStudents.includes(s));

  return `
  <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
         <!--Present List-->
         <div class="glass-card p-4 rounded-2xl border-l-4 border-emerald-500">
             <h4 class="font-bold text-lg mb-3 flex justify-between">
                <span class="text-emerald-700">Present (${presentStudents.length})</span>
                <span class="text-xs bg-emerald-100 text-emerald-600 px-2 py-1 rounded">View %</span>
             </h4>
             <div class="max-h-[300px] overflow-y-auto space-y-2">
                 ${presentStudents.map(s => `
                    <div class="p-2 bg-slate-50 rounded-lg flex justify-between items-center">
                        <div>
                            <p class="font-bold text-sm text-slate-700">${s.name}</p>
                            <p class="text-[10px] text-slate-400">${s.registration_no}</p>
                        </div>
                        <div class="text-right">
                           <span class="text-[10px] text-emerald-600 font-bold">● Present</span>
                        </div>
                    </div>
                 `).join('') || '<p class="text-xs text-slate-400">No students marked present yet.</p>'}
             </div>
         </div>

         <!--Absent List-->
  <div class="glass-card p-4 rounded-2xl border-l-4 border-rose-500">
    <h4 class="font-bold text-lg mb-3 flex justify-between">
      <span class="text-rose-700">Absent (${absentStudents.length})</span>
      <button onclick="notifyAllAbsent()" class="text-xs bg-rose-100 text-rose-600 px-2 py-1 rounded hover:bg-rose-200">Notify All 📢</button>
    </h4>
    <div class="max-h-[300px] overflow-y-auto space-y-2">
      ${absentStudents.map(s => `
                    <div class="p-2 bg-slate-50 rounded-lg flex justify-between items-center group">
                        <div>
                            <p class="font-bold text-sm text-slate-700">${s.name}</p>
                            <p class="text-[10px] text-slate-400">${s.registration_no}</p>
                            <p class="text-[9px] text-indigo-400">📱 ${s.mobile_number || 'No Mobile'}</p>
                        </div>
                        <div class="text-right">
                           <span class="text-[10px] text-rose-600 font-bold block">Absent</span>
                           <button onclick="sendAbsentSMS('${s.registration_no}')" class="text-[9px] underline text-slate-400 hover:text-indigo-600">Send SMS</button>
                        </div>
                    </div>
                 `).join('')}
    </div>
  </div>
      </div>
  `;
}

// Teacher Dashboard
function renderTeacherDashboard() {
  const config = window.elementSdk.config;
  const app = document.getElementById('app');
  app.className = "w-full h-full overflow-y-auto mesh-bg font-sans";

  // Calculate Stats for today
  const students = Object.values(demoUsers).filter(u => u.role === 'student');
  const today = new Date().toISOString().split('T')[0];
  const totalStudents = students.length;

  const presentCount = students.filter(s =>
    allData.some(d => d.student_id === s.registration_no && d.date === today && d.present)
  ).length;

  const absentsCount = totalStudents - presentCount;
  const presentPercentage = totalStudents > 0 ? Math.round((presentCount / totalStudents) * 100) : 0;

  app.innerHTML = `
  <div class="min-h-full p-6 md:p-10 font-sans text-slate-800 relative z-10">
        <header class="flex flex-col md:flex-row justify-between items-center mb-10 fade-in-up">
          <div>
            <h1 class="text-4xl font-extrabold gradient-text mb-1">Teacher Dashboard</h1>
            <p class="text-slate-500 font-medium">Class Management & AI Attendance</p>
          </div>
          <button onclick="logout()" class="px-5 py-2.5 bg-red-50 text-red-600 font-medium rounded-xl hover:bg-red-100 transition shadow-sm border border-red-100">
            Log Out
          </button>
        </header>

        <!--TOP ROW: Camera(Left) + Stats(Right)-->
        <div class="grid grid-cols-1 xl:grid-cols-3 gap-8 mb-8">
          
          <!-- CCTV Monitoring Section (Occupies 2/3) -->
          <div class="xl:col-span-2 glass-card p-6 rounded-3xl fade-in-up" style="animation-delay: 0.1s;">
            <div class="flex justify-between items-center mb-6">
              <h2 class="text-xl font-bold text-slate-800 flex items-center gap-2">
                🕵️ CCTV Class Monitor
              </h2>
              <div id="cctvBadge" class="flex gap-2">
                <span class="px-3 py-1 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-600 border border-emerald-100 flex items-center gap-1">
                  <div class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div> SYSTEM ACTIVE
                </span>
                <span class="px-3 py-1 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-600 border border-indigo-100">
                  <span id="faceCount">0</span> STUDENTS DETECTED
                </span>
              </div>
            </div>

            <div id="videoContainer" class="relative rounded-2xl overflow-hidden bg-slate-900 mb-6 aspect-video shadow-inner ring-8 ring-slate-100/50">
              <video id="faceVideo" class="w-full h-full object-cover grayscale-[0.3]" autoplay playsinline></video>
              <canvas id="faceOverlay" class="absolute top-0 left-0 w-full h-full pointer-events-none"></canvas>
              
              <div class="relative z-10 p-4">
                  <div id="recognitionDisplay" style="display:none;" class="bg-white/90 backdrop-blur rounded-xl p-3 shadow-lg max-w-[200px]">
                      <div id="recognizedStudent"></div>
                  </div>
              </div>
            </div>

            <div class="flex gap-4">
              <button id="cameraButton" onclick="toggleCamera()"
                class="flex-1 py-4 rounded-2xl font-bold text-white bg-gradient-to-r from-indigo-500 to-purple-600 shadow-lg shadow-indigo-200 hover:shadow-indigo-400/50 transition-all flex items-center justify-center gap-3 active:scale-[0.98]">
                <span id="cameraIcon">🎥</span> <span id="cameraText">Initialize CCTV Feed</span>
              </button>
            </div>
            <p id="cameraStatus" class="text-center text-sm mt-4 text-slate-500">Tap to start</p>
          </div>

          <!-- Stats & Actions Section (Occupies 1/3) -->
          <div class="xl:col-span-1 space-y-6 fade-in-up" style="animation-delay: 0.2s;">
            
            <!-- Daily Overview Card -->
            <div class="glass-card p-6 rounded-3xl relative overflow-hidden">
               <div class="absolute top-0 right-0 p-6 opacity-5">
                  <span class="text-9xl">📊</span>
               </div>
               <h3 class="font-bold text-lg text-slate-800 mb-6">Attendance Overview</h3>
               
               <div class="flex items-center justify-center mb-8 relative">
                  <!-- Circular Progress Placeholder -->
                  <div class="w-40 h-40 rounded-full border-[12px] border-slate-100 flex items-center justify-center relative">
                     <div class="absolute inset-0 rounded-full border-[12px] border-indigo-500" style="clip-path: circle(${presentPercentage}% at 50% 50%); opacity: 0.2;"></div> <!-- Mock visual -->
                     <svg class="absolute inset-0 transform -rotate-90 pointer-events-none" width="100%" height="100%" viewBox="0 0 100 100">
                        <circle cx="50" cy="50" r="44" stroke="currentColor" stroke-width="12" fill="none" class="text-indigo-600" stroke-dasharray="276" stroke-dashoffset="${276 - (276 * presentPercentage / 100)}"></circle>
                     </svg>
                     <div class="text-center">
                        <div class="text-4xl font-black text-slate-800">${presentPercentage}%</div>
                        <div class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Present</div>
                     </div>
                  </div>
               </div>

               <div class="grid grid-cols-2 gap-4 mb-6">
                  <div class="p-4 bg-emerald-50 rounded-2xl border border-emerald-100 text-center">
                     <div class="text-2xl font-bold text-emerald-600">${presentCount}</div>
                     <div class="text-[10px] uppercase font-bold text-emerald-400">Present</div>
                  </div>
                  <div class="p-4 bg-rose-50 rounded-2xl border border-rose-100 text-center">
                     <div class="text-2xl font-bold text-rose-600">${absentsCount}</div>
                     <div class="text-[10px] uppercase font-bold text-rose-400">Absent</div>
                  </div>
               </div>

               <button onclick="exportAttendanceToCSV()" class="w-full py-3 bg-slate-800 text-white font-bold rounded-xl shadow-lg flex items-center justify-center gap-2 hover:bg-slate-700 transition">
                  <span>📥</span> Export Daily Report
               </button>
            </div>

            <!-- Manual Entry (Moved here) -->
            <div class="glass-card p-6 rounded-3xl bg-blue-50/50">
               <h3 class="font-bold text-sm text-slate-800 mb-3">Quick Manual Entry</h3>
               <div class="flex gap-2">
                 <input type="text" id="manualReg" placeholder="Reg No..." class="input-modern flex-1 px-3 py-2 text-sm rounded-lg">
                 <button onclick="markManual()" class="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-bold">Mark</button>
               </div>
            </div>

          </div>
        </div>

        <!--BOTTOM ROW: Student Lists-->
        <div class="glass-card p-8 rounded-3xl fade-in-up mb-8" style="animation-delay: 0.3s;">
          <h3 class="font-bold text-xl text-slate-800 mb-6">Detailed Student Lists</h3>
          ${renderTeacherAttendanceLists()}
        </div>

      </div>
  `;

  // Re-attach camera UI state if active
  if (isCameraActive) {
    updateCameraUI();
    // Re-attach stream to the new video element
    const video = document.getElementById('faceVideo');
    if (video && videoStream) {
      video.srcObject = videoStream;
      video.play().catch(e => console.log("Autoplay prevented:", e));

      // Restart scanning loop if needed, though the loop uses the element reference.
      // The face-api loop might need the new canvas reference too.
      const canvas = document.getElementById('faceOverlay');
      if (isScanning) {
        // We might need to restart the scanner or ensure the old scanner loop finds the new elements.
        // The old scanner loop has 'video' and 'canvas' variables closed over from startAiScanning. 
        // We should probably restart the scanner to be safe, or update global refs.
        // Simplest fix: The scanning loop likely fails once element is removed.
        // Let's restart it.
        stopCamera(); // Stop old tracks/loops cleanly
        startCamera(); // Restart everything cleanly
      }
    }
  }
}

// Export to CSV Function
window.exportAttendanceToCSV = function () {
  const today = new Date().toISOString().split('T')[0];
  const students = Object.values(demoUsers).filter(u => u.role === 'student');

  // Header
  let csvContent = "data:text/csv;charset=utf-8,";
  csvContent += "Student Name,Registration No,Branch,Year,Date,Status,Time Marked,Mode\n";

  students.forEach(student => {
    const record = allData.find(d => d.student_id === student.registration_no && d.date === today && d.present);

    let status = "Absent";
    let time = "-";
    let mode = "-";

    if (record) {
      status = "Present";
      time = new Date(record.created_at).toLocaleTimeString();
      mode = record.auto_marked ? "AI Camera" : "Manual";
    }

    const row = [
      student.name,
      student.registration_no,
      student.branch || "N/A",
      student.year || "N/A",
      today,
      status,
      time,
      mode
    ].map(item => `"${item}"`).join(","); // Quote fields to handle commas in names etc

    csvContent += row + "\r\n";
  });

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `Attendance_Report_${today}.csv`);
  document.body.appendChild(link);
  link.click();

  showNotification("Downloading Attendance Report...", "success");
  document.body.removeChild(link);
};

window.markManual = async function () {
  const reg = document.getElementById('manualReg').value.toUpperCase();
  const students = Object.values(demoUsers).filter(u => u.role === 'student');
  const student = students.find(s => s.registration_no === reg);

  if (student) {
    await markAttendanceAutomatically(student, 1.0);
    showNotification(`Manual entry for ${student.name} successful`, 'success');
    renderTeacherDashboard(); // Refresh
  } else {
    showNotification('Student not found!', 'error');
  }
}

window.sendAbsentSMS = async function (regNo) {
  const student = demoUsers[regNo];
  if (student) {
    const message = `Alert: Student ${student.name} (${student.registration_no}) is marked ABSENT today.Please ensure regular attendance. - Excellence University`;

    // 1. IMMEDIATE: Open Default SMS App (Works on Phone/PC)
    // This allows you to send the SMS immediately without paying for an API right now.
    const encodedMsg = encodeURIComponent(message);
    const mobile = student.mobile_number;
    window.open(`sms:${mobile}?body=${encodedMsg}`, '_blank');

    showNotification(`📱 Opening messaging app for ${student.name}...`, 'info');

    // 2. AUTOMATED (Requires API Key):
    // To send fully automatic SMS, sign up at www.fast2sms.com (India) or Twilio (Global).
    // Get your API KEY from their dashboard and uncomment the code below:

    /*
    const apiKey = "YOUR_API_KEY_HERE"; // <-- Paste your Fast2SMS API Key here
    const url = "https://www.fast2sms.com/dev/bulkV2";
    
    try {
      // Note: This often requires a backend server to work due to browser security (CORS).
      // If testing locally, you might need a CORS extension or a proxy.
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'authorization': apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          "route": "q",
          "message": message,
          "language": "english",
          "flash": 0,
          "numbers": mobile,
        })
      });
      console.log("SMS API Response:", await response.json());
      showNotification("✓ SMS sent via API!", "success");
    } catch (e) {
      console.error("SMS API Error:", e);
      showNotification("Error sending automatic SMS. Using manual mode.", "warning");
    }
    */
  }
}

window.notifyAllAbsent = function () {
  const students = Object.values(demoUsers).filter(u => u.role === 'student');
  const today = new Date().toISOString().split('T')[0];

  // Calculate absent students for data realism
  const presentStudents = students.filter(s =>
    allData.some(d => d.student_id === s.registration_no && d.date === today && d.present)
  );
  const absentStudents = students.filter(s => !presentStudents.includes(s));

  if (absentStudents.length === 0) {
    showNotification("Everyone is present! No SMS needed.", "success");
    return;
  }

  showNotification(`ℹ Bulk SMS via Default App is restricted by browser.Opening for 1st student...`, "info");

  // Open for the first student as a demo
  if (absentStudents.length > 0) {
    setTimeout(() => {
      sendAbsentSMS(absentStudents[0].registration_no);
    }, 1000);
  }
}

function renderAdminDashboard() {
  const config = window.elementSdk.config;
  const app = document.getElementById('app');
  app.className = "w-full h-full overflow-y-auto mesh-bg font-sans";

  const users = Object.values(demoUsers);
  const totalStudents = users.filter(u => u.role === 'student').length;

  // Calculate Avg Attendance (mock logic based on real data)
  const today = new Date().toISOString().split('T')[0];
  const presentToday = allData.filter(d => d.date === today && d.present).length;
  const avgAttendance = totalStudents > 0 ? Math.round((presentToday / totalStudents) * 100) : 0;

  // Predict Risk (students with < 75% attendance overall - simplified mock logic)
  const riskStudents = users.filter(u => u.role === 'student').length > 0 ? Math.floor(totalStudents * 0.15) : 0;

  app.innerHTML = `
    <div class="min-h-full p-6 md:p-10 font-sans text-slate-800 relative z-10">
        <header class="flex flex-col md:flex-row justify-between items-center mb-10 fade-in-up">
          <div>
            <h1 class="text-4xl font-extrabold gradient-text mb-1">Admin Portal</h1>
            <p class="text-slate-500 font-medium">System Overview</p>
          </div>
          <button onclick="logout()" class="px-5 py-2.5 bg-red-50 text-red-600 font-medium rounded-xl hover:bg-red-100 transition shadow-sm border border-red-100">
            Log Out
          </button>
        </header>

        <!--Stats Row-->
        <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-10 fade-in-up" style="animation-delay: 0.1s;">
          <div class="p-6 rounded-3xl shadow-lg relative overflow-hidden group text-white transform hover:-translate-y-1 transition duration-300">
            <div class="absolute inset-0 bg-gradient-to-br from-indigo-500 to-purple-600"></div>
            <div class="relative z-10">
              <h4 class="text-indigo-100 font-medium text-sm mb-2">Total Students</h4>
              <span class="text-4xl font-bold tracking-tight">${totalStudents}</span>
            </div>
            <div class="absolute -right-6 -bottom-6 text-9xl opacity-10 group-hover:scale-110 transition-transform">👥</div>
          </div>

          <div class="p-6 rounded-3xl shadow-lg relative overflow-hidden group text-white transform hover:-translate-y-1 transition duration-300">
            <div class="absolute inset-0 bg-gradient-to-br from-emerald-400 to-teal-600"></div>
            <div class="relative z-10">
              <h4 class="text-emerald-100 font-medium text-sm mb-2">Avg. Attendance</h4>
              <span class="text-4xl font-bold tracking-tight">${avgAttendance}%</span>
            </div>
            <div class="absolute -right-6 -bottom-6 text-9xl opacity-10 group-hover:scale-110 transition-transform">📈</div>
          </div>

          <div class="p-6 rounded-3xl shadow-lg relative overflow-hidden group text-white transform hover:-translate-y-1 transition duration-300">
            <div class="absolute inset-0 bg-gradient-to-br from-rose-400 to-red-600"></div>
            <div class="relative z-10">
              <h4 class="text-rose-100 font-medium text-sm mb-2">At Risk</h4>
              <span class="text-4xl font-bold tracking-tight">${riskStudents}</span>
            </div>
            <div class="absolute -right-6 -bottom-6 text-9xl opacity-10 group-hover:scale-110 transition-transform">⚠️</div>
          </div>

        </div>

        <div class="grid grid-cols-1 xl:grid-cols-2 gap-8 mb-10 fade-in-up" style="animation-delay: 0.2s;">
          <!-- User Management -->
          <div class="glass-card p-8 rounded-3xl">
            <h3 class="font-bold text-xl text-slate-800 mb-6 flex items-center gap-2">
              👤 User Management (Admissions & HR)
            </h3>
            <form onsubmit="submitNewUser(event)" class="space-y-4">
              <div class="grid grid-cols-2 gap-4">
                <div class="space-y-1">
                  <label class="text-[10px] font-bold text-slate-400 uppercase tracking-widest pl-1">Full Name</label>
                  <input type="text" id="newUserName" required placeholder="John Doe"
                    class="w-full px-4 py-3 rounded-xl bg-slate-50 border-0 text-slate-800 placeholder-slate-400 focus:ring-2 focus:ring-indigo-500 shadow-sm transition">
                </div>
                <div class="space-y-1">
                  <label class="text-[10px] font-bold text-slate-400 uppercase tracking-widest pl-1">Registration No.</label>
                  <input type="text" id="newUserReg" required placeholder="STU2024..."
                    class="w-full px-4 py-3 rounded-xl bg-slate-50 border-0 text-slate-800 placeholder-slate-400 focus:ring-2 focus:ring-indigo-500 shadow-sm transition">
                </div>
              </div>
              
              <div class="grid grid-cols-2 gap-4">
                <div class="space-y-1">
                  <label class="text-[10px] font-bold text-slate-400 uppercase tracking-widest pl-1">Role</label>
                  <select id="newUserRole" class="w-full px-4 py-3 rounded-xl bg-slate-50 border-0 text-slate-800 focus:ring-2 focus:ring-indigo-500 shadow-sm transition">
                    <option value="student">Student</option>
                    <option value="teacher">Teacher</option>
                  </select>
                </div>
                <div class="space-y-1">
                  <label class="text-[10px] font-bold text-slate-400 uppercase tracking-widest pl-1">Course/Dept</label>
                  <input type="text" id="newUserCourse" required placeholder="B.Tech CSE"
                    class="w-full px-4 py-3 rounded-xl bg-slate-50 border-0 text-slate-800 placeholder-slate-400 focus:ring-2 focus:ring-indigo-500 shadow-sm transition">
                </div>
              </div>

              <button type="submit" class="w-full py-4 bg-indigo-600 text-white font-bold rounded-2xl shadow-lg shadow-indigo-200 hover:shadow-indigo-400 transition transform hover:-translate-y-0.5 active:scale-95">
                Confirm Admission / Appointment
              </button>
            </form>
          </div>

          <!-- Campus Operations Hub -->
          <div class="glass-card p-8 rounded-3xl bg-slate-900 text-white overflow-hidden relative">
            <div class="relative z-10">
              <h3 class="font-bold text-xl mb-8 flex items-center gap-2">
                🏢 Campus Operations Hub
              </h3>
              
              <div class="grid grid-cols-2 gap-6">
                <!-- Energy Usage -->
                <div class="p-5 bg-white/5 rounded-2xl border border-white/10 hover:bg-white/10 transition group">
                  <div class="flex justify-between items-center mb-4">
                    <span class="text-[10px] font-bold text-white/40 uppercase tracking-widest">Energy Use</span>
                    <span class="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 rounded-md text-[8px] font-bold">-12% ▼</span>
                  </div>
                  <div class="text-2xl font-black mb-1">14.2 KW/h</div>
                  <div class="h-10 w-full flex items-end gap-1 mt-4">
                    ${[30, 45, 25, 60, 40, 55, 35, 70, 50, 65].map(h => `<div class="flex-1 bg-indigo-500/30 rounded-t-sm group-hover:bg-indigo-500 transition-all duration-500" style="height: ${h}%"></div>`).join('')}
                  </div>
                </div>

                <!-- Building Occupancy -->
                <div class="p-5 bg-white/5 rounded-2xl border border-white/10 hover:bg-white/10 transition">
                  <div class="flex justify-between items-center mb-4">
                    <span class="text-[10px] font-bold text-white/40 uppercase tracking-widest">Occupancy</span>
                    <div class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                  </div>
                  <div class="text-2xl font-black mb-1">2,450</div>
                  <span class="text-[10px] font-medium opacity-50">Across 4 Buildings</span>
                  
                  <div class="mt-4 flex -space-x-2">
                     <div class="w-6 h-6 rounded-full bg-rose-500 border-2 border-slate-900 flex items-center justify-center text-[8px] font-bold">A</div>
                     <div class="w-6 h-6 rounded-full bg-blue-500 border-2 border-slate-900 flex items-center justify-center text-[8px] font-bold">B</div>
                     <div class="w-6 h-6 rounded-full bg-emerald-500 border-2 border-slate-900 flex items-center justify-center text-[8px] font-bold">C</div>
                     <div class="w-6 h-6 rounded-full bg-slate-700 border-2 border-slate-900 flex items-center justify-center text-[8px] font-bold">+2k</div>
                  </div>
                </div>

                <!-- IT Support Tickets -->
                <div class="p-5 bg-white/5 rounded-2xl border border-white/10 hover:bg-white/10 transition col-span-2">
                  <div class="flex justify-between mb-2">
                    <span class="text-[10px] font-bold text-white/40 uppercase tracking-widest">IT Support Tickets</span>
                    <span class="text-[10px] font-bold text-indigo-400 uppercase tracking-widest">92% Resolved</span>
                  </div>
                  <div class="flex items-center gap-4">
                    <div class="text-3xl font-black">12</div>
                    <span class="text-xs font-medium opacity-50">Active tickets requiring attention</span>
                    <button class="ml-auto px-4 py-2 bg-indigo-600 rounded-xl text-[10px] font-bold shadow-lg shadow-indigo-600/30">Go to Helpdesk</button>
                  </div>
                </div>
              </div>
            </div>
            <!-- Decorative background element -->
            <div class="absolute -right-20 -bottom-20 w-64 h-64 bg-indigo-500/10 blur-[100px] rounded-full"></div>
          </div>
        </div>

        <!--Enrollment & Retention Row-->
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-10 fade-in-up" style="animation-delay: 0.3s;">
           
           <div class="glass-card p-8 rounded-3xl lg:col-span-2">
             <div class="flex justify-between items-center mb-8">
               <h3 class="font-bold text-xl text-slate-800">Enrollment & Retention Analytics</h3>
               <div class="flex gap-2">
                 <button class="px-3 py-1 bg-slate-100 rounded-lg text-xs font-bold text-slate-600">Yearly</button>
                 <button class="px-3 py-1 bg-indigo-600 rounded-lg text-xs font-bold text-white">Monthly</button>
               </div>
             </div>
             
             <div class="space-y-8">
               <div>
                  <div class="flex justify-between text-sm font-bold text-slate-600 mb-2">
                    <span>Student Retention Rate</span>
                    <span class="text-indigo-600">94.2%</span>
                  </div>
                  <div class="h-3 w-full bg-slate-100 rounded-full overflow-hidden">
                    <div class="h-full bg-gradient-to-r from-indigo-500 to-purple-600 w-[94.2%] transition-all duration-1000"></div>
                  </div>
               </div>

               <div>
                  <div class="flex justify-between text-sm font-bold text-slate-600 mb-2">
                    <span>Predicted Dropout Risk (AI Projection)</span>
                    <span class="text-rose-500 font-black tracking-tighter">↓ 2.4% IMPROVEMENT</span>
                  </div>
                  <div class="h-3 w-full bg-slate-100 rounded-full overflow-hidden">
                    <div class="h-full bg-gradient-to-r from-rose-400 to-rose-600 w-[65%] transition-all duration-1000"></div>
                  </div>
                  <p class="text-[10px] text-slate-400 mt-2">Projection based on current attendance trends and engagement metrics.</p>
               </div>
             </div>
           </div>

           <div class="glass-card p-8 rounded-3xl bg-gradient-to-br from-indigo-600 to-indigo-800 text-white flex flex-col justify-center items-center text-center">
              <div class="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center text-3xl mb-4 backdrop-blur-lg">🏗️</div>
              <h4 class="font-bold text-lg mb-2">Campus Expansion</h4>
              <p class="text-sm opacity-60 mb-6">New Engineering Block C is 85% completed. Expected inauguration: March 2024.</p>
              <div class="w-full bg-white/10 h-1 rounded-full mb-6">
                 <div class="h-full bg-white w-[85%]"></div>
              </div>
              <button class="w-full py-3 bg-white text-indigo-800 font-bold rounded-xl text-xs">Track Progress</button>
           </div>
        </div>

        <!--Table Section-->
    <div class="glass-card rounded-3xl p-8 fade-in-up" style="animation-delay: 0.2s;">
      <div class="flex justify-between items-center mb-6">
        <h3 class="font-bold text-xl text-slate-800">System Users</h3>
        <button class="text-sm font-bold text-indigo-600 hover:text-indigo-800">View All →</button>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-left border-collapse">
          <thead>
            <tr class="text-slate-400 text-sm uppercase tracking-wider border-b border-slate-100">
              <th class="pb-4 font-semibold pl-4">User Details</th>
              <th class="pb-4 font-semibold">Role</th>
              <th class="pb-4 font-semibold">ID / Reg No.</th>
              <th class="pb-4 font-semibold pr-4 text-right">Status</th>
            </tr>
          </thead>
          <tbody class="text-sm">
            ${users.map(u => `
              <tr class="group hover:bg-slate-50 transition-colors border-b border-slate-50 last:border-0">
                <td class="py-4 pl-4">
                  <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-full ${u.role === 'teacher' ? 'bg-purple-100 text-purple-600' : 'bg-indigo-100 text-indigo-600'} flex items-center justify-center font-bold">
                      ${u.name.split(' ').map(n => n[0]).join('')}
                    </div>
                    <span class="font-bold text-slate-700">${u.name}</span>
                  </div>
                </td>
                <td class="py-4">
                  <span class="px-3 py-1 ${u.role === 'teacher' ? 'bg-purple-50 text-purple-600 border-purple-100' : 'bg-blue-50 text-blue-600 border-blue-100'} rounded-lg text-xs font-bold uppercase tracking-wider text-[10px] border">
                    ${u.role}
                  </span>
                </td>
                <td class="py-4 font-mono text-slate-500">${u.registration_no}</td>
                <td class="py-4 pr-4 text-right">
                  <div class="flex items-center justify-end gap-3">
                    <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-600 text-xs font-bold">
                      <div class="w-1.5 h-1.5 rounded-full bg-emerald-500"></div> Active
                    </span>
                    <button onclick="deleteUser('${u.registration_no}')" class="p-1.5 text-slate-300 hover:text-rose-500 transition-colors">
                      🗑️
                    </button>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
      </div>
  `;
}

// Admin Management Functions
window.submitNewUser = async function (event) {
  event.preventDefault();
  const name = document.getElementById('newUserName').value;
  const regNo = document.getElementById('newUserReg').value;
  const role = document.getElementById('newUserRole').value;
  const course = document.getElementById('newUserCourse').value;

  if (demoUsers[regNo]) {
    showNotification('User with this ID already exists!', 'error');
    return;
  }

  showNotification(`📋 Registering ${role}...`, "info");

  const userData = {
    name,
    registration_no: regNo,
    role,
    branch: course, // Map course to branch
    year: '1st',
    mobile_number: '+91 9999999999',
    email: `${regNo.toLowerCase()}@smartport.edu`,
    password: 'pass123'
  };

  try {
    // 1. Update local demoUsers for immediate UI feedback
    demoUsers[regNo] = userData;

    // 2. Persist to Firestore
    const result = await window.dataSdk.createUser(userData);

    if (result.isOk) {
      showNotification(`✨ ${name} added successfully!`, "success");
      event.target.reset();
      renderAdminDashboard(); // Refresh UI
    } else {
      showNotification(`⚠️ Saved locally, but DB Error: ${result.error}`, "warning");
      renderAdminDashboard();
    }
  } catch (err) {
    console.error("Registration error:", err);
    showNotification(`❌ Connection Error - Saved Locally`, "error");
    renderAdminDashboard();
  }
};

window.deleteUser = function (regNo) {
  if (confirm(`Are you sure you want to delete user ${regNo}?`)) {
    if (regNo === currentUser.registration_no) {
      showNotification('You cannot delete yourself!', 'error');
      return;
    }
    delete demoUsers[regNo];
    showNotification('User deleted successfully.', 'info');
    renderAdminDashboard(); // Refresh
  }
};

// Initial render happens inside elementSdk.init() below (its onConfigChange fires
// immediately). If the SDK is ever unavailable, fall back to a direct render.
if (typeof window.elementSdk === 'undefined') {
  renderLogin();
}

// Element SDK implementation (Replacing the broken one)
window.elementSdk.init({
  defaultConfig,
  onConfigChange: async (config) => {
    if (!currentUser) {
      renderLogin();
    } else {
      renderDashboard();
    }
  }
});

// Initialize Data SDK
window.dataSdk.init(dataHandler).then(result => {
  if (result.isOk) {
    console.log("Data SDK Initialized Successfully");
    showNotification("☁️ Connected to Cloud Database", "success");
  } else {
    console.error("Failed to initialize Data SDK", result.error);
    showNotification("⚠️ Offline Mode: " + (result.error || "Check Config"), "warning");
  }
});

// Face Registration View
function renderFaceRegistration() {
  const config = window.elementSdk.config;
  const fontSize = config.font_size || defaultConfig.font_size;

  return `
    <div class="max-w-4xl mx-auto">
      <div class="glass-card p-8 rounded-3xl mb-8">
        <div class="flex items-center gap-4 mb-6">
          <div class="w-12 h-12 bg-indigo-500 text-white rounded-2xl flex items-center justify-center text-2xl">👤</div>
          <div>
            <h3 class="font-bold text-2xl">Face ID Registration</h3>
            <p class="text-slate-500">Register your face to enable AI-powered attendance tracking.</p>
          </div>
        </div>

        <div id="registrationCameraContainer" class="relative rounded-2xl overflow-hidden bg-slate-900 mb-8 aspect-video shadow-2xl ring-4 ring-indigo-100">
          <video id="registrationVideo" class="w-full h-full object-cover grayscale-[0.2]" autoplay playsinline></video>
          <div class="absolute inset-0 border-[40px] border-black/20 pointer-events-none"></div>
          <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 border-2 border-dashed border-white/50 rounded-full pointer-events-none"></div>

          <div id="registrationStatusOverlay" class="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center text-white hidden">
            <div class="spinner mb-4"></div>
            <p class="font-bold" id="registrationStatusText">Capturing your facial features...</p>
          </div>
        </div>

        <div class="flex flex-col items-center gap-6">
          <div class="text-center max-w-md">
            <p class="text-slate-600 font-medium mb-4">
              Position your face in the center of the frame. Ensure you are in a well-lit area without glasses or masks.
            </p>
          </div>

          <div class="flex gap-4 w-full md:w-auto">
            <button id="startRegBtn" onclick="startRegistrationCamera()" 
              class="px-8 py-4 bg-indigo-600 text-white font-bold rounded-2xl shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition">
              Start Camera
            </button>
            <button id="captureRegBtn" onclick="performFaceRegistration()" 
              class="px-8 py-4 bg-emerald-500 text-white font-bold rounded-2xl shadow-lg shadow-emerald-200 hover:bg-emerald-600 transition hidden">
              Register My Face
            </button>
          </div>
        </div>
      </div>

      <div class="glass-card p-6 rounded-3xl bg-amber-50 border border-amber-100">
        <h4 class="font-bold text-amber-800 mb-2 flex items-center gap-2">
          💡 Privacy Notice
        </h4>
        <p class="text-sm text-amber-700 opacity-90">
          We do not store your actual images. Our AI converts your facial features into a mathematical signature (Face ID) which is used solely for attendance purposes.
        </p>
      </div>
    </div>
    `;
}

// Global functions for registration
window.startRegistrationCamera = async function () {
  try {
    showNotification('🔄 Loading AI models...', 'info');

    // Ensure face-api models are loaded before starting camera
    await faceRecognition.loadModels();

    showNotification('📷 Starting camera...', 'info');
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: 640, height: 480 }
    });

    const video = document.getElementById('registrationVideo');
    if (video) {
      videoStream = stream;
      video.srcObject = stream;
      await video.play();

      document.getElementById('startRegBtn').classList.add('hidden');
      document.getElementById('captureRegBtn').classList.remove('hidden');
      showNotification('✅ Camera ready! Position your face in the frame.', 'success');
      console.log('✓ Registration camera started successfully');
    }
  } catch (err) {
    console.error('❌ Registration camera error:', err);
    if (err.name === 'NotAllowedError') {
      showNotification('Camera access denied. Please allow camera permissions.', 'error');
    } else if (err.name === 'NotFoundError') {
      showNotification('No camera found on this device.', 'error');
    } else {
      showNotification('Unable to access camera: ' + err.message, 'error');
    }
  }
};

window.performFaceRegistration = async function () {
  const video = document.getElementById('registrationVideo');
  const overlay = document.getElementById('registrationStatusOverlay');
  const statusText = document.getElementById('registrationStatusText');

  if (!video) {
    console.error('❌ Video element not found');
    return;
  }

  overlay.classList.remove('hidden');
  statusText.textContent = '🔍 Analyzing facial features...';
  console.log('🎯 Starting face registration for:', currentUser.registration_no);

  try {
    // Ensure models are loaded
    if (!faceRecognition.modelsLoaded) {
      statusText.textContent = '⏳ Loading AI models...';
      await faceRecognition.loadModels();
    }

    statusText.textContent = '📸 Capturing face descriptor...';
    const result = await faceRecognition.captureDescriptor(video);

    if (!result.success) {
      console.error('❌ Face capture failed:', result.error);
      showNotification(result.error, 'error');
      overlay.classList.add('hidden');
      return;
    }

    console.log('✓ Face descriptor captured successfully (128 dimensions)');
    statusText.textContent = '💾 Saving to your profile...';

    const saveResult = await window.dataSdk.saveFaceDescriptor(currentUser.registration_no, result.descriptor);

    if (saveResult.isOk) {
      console.log('✅ Face ID registration complete for:', currentUser.registration_no);
      showNotification('✨ Face ID successfully registered!', 'success');

      // Wait a bit then refresh
      setTimeout(() => {
        if (videoStream) {
          videoStream.getTracks().forEach(track => track.stop());
          videoStream = null;
        }
        setStudentView('home');
      }, 2000);
    } else {
      console.error('❌ Failed to save descriptor:', saveResult.error);
      showNotification('Error saving registration: ' + saveResult.error, 'error');
      overlay.classList.add('hidden');
    }

  } catch (err) {
    console.error('❌ Registration error:', err);
    showNotification('Something went wrong during registration: ' + err.message, 'error');
    overlay.classList.add('hidden');
  }
};

// Manual Attendance for Teacher
window.handleManualAttendance = async function () {
  const input = document.getElementById('manualReg');
  if (!input) return;

  const regNo = input.value.trim().toUpperCase();
  if (!regNo) {
    showNotification("Please enter a Registration Number", "warning");
    return;
  }

  // Create a manual record
  const record = {
    id: `ATT_${Date.now()}_${regNo}`,
    type: 'attendance',
    student_id: regNo,
    student_name: 'Manual Entry', // In a real app we would fetch name from DB
    date: new Date().toISOString().split('T')[0],
    present: true,
    auto_marked: false, // Manual
    created_at: new Date().toISOString()
  };

  const result = await window.dataSdk.create(record);
  if (result.isOk) {
    showNotification(`Attendance marked for ${regNo}`, "success");
    input.value = "";
  } else {
    showNotification(`Error: ${result.error}`, "error");
  }
};

// Helper: Get Subjects based on course
function getSubjectsForCourse(course) {
  const common = [
    { name: "Communication Skills", code: "ENG101", faculty: "Dr. Sarah", attendance: 92, color: "blue", icon: "💬" }
  ];

  if (!course) return common;

  if (course.includes("CSE")) {
    return [
      { name: "Data Structures", code: "CS201", faculty: "Prof. Amit Verma", attendance: 85, color: "indigo", icon: "💻" },
      { name: "Algorithms", code: "CS202", faculty: "Dr. K. Rao", attendance: 78, color: "purple", icon: "⚡" },
      { name: "Operating Systems", code: "CS204", faculty: "Prof. John Doe", attendance: 88, color: "emerald", icon: "⚙️" },
      ...common
    ];
  } else if (course.includes("IT")) {
    return [
      { name: "Web Technologies", code: "IT301", faculty: "Ms. Anjali", attendance: 90, color: "pink", icon: "🌐" },
      { name: "Database Systems", code: "IT302", faculty: "Dr. R. Gupta", attendance: 82, color: "orange", icon: "🗄️" },
      ...common
    ];
  } else if (course.includes("ECE")) {
    return [
      { name: "Digital Circuits", code: "EC201", faculty: "Prof. Reddy", attendance: 75, color: "red", icon: "🔌" },
      { name: "Signals & Systems", code: "EC205", faculty: "Dr. Bose", attendance: 80, color: "teal", icon: "📈" },
      ...common
    ];
  } else if (course.includes("ME")) {
    return [
      { name: "Thermodynamics", code: "ME201", faculty: "Dr. H. Singh", attendance: 88, color: "red", icon: "🔥" },
      { name: "Fluid Mechanics", code: "ME202", faculty: "Prof. K. Lal", attendance: 80, color: "blue", icon: "🌊" },
      ...common
    ];
  } else {
    // Default / Mock
    return [
      { name: "Mathematics I", code: "MAT101", faculty: "Dr. Raman", attendance: 95, color: "cyan", icon: "📐" },
      { name: "Physics", code: "PHY101", faculty: "Prof. H. C. Verma", attendance: 85, color: "amber", icon: "⚛️" },
      ...common
    ];
  }
}


