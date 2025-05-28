import express from 'express';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import bodyParser from 'body-parser';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '50mb' }));            // :contentReference[oaicite:5]{index=5}
// Allow URL-encoded bodies up to 10 MB
app.use(express.urlencoded({ limit: '50mb', extended: true }));  // :contentReference[oaicite:6]{index=6}

// Simple request logging middleware
app.use((req, res, next) => {
  const startTime = Date.now();
  const requestId = uuidv4();
  
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);

  res.on('finish', () => {
    const duration = Date.now() - startTime;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} - Status: ${res.statusCode} (${duration}ms)`);
  });

  next();
});

// Configure CORS with specific options
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control'],
  exposedHeaders: ['Content-Type', 'Authorization', 'Cache-Control'],
  credentials: true,
  maxAge: 86400 // 24 hours
}));

app.use(bodyParser.json());


// Login endpoint
app.post('/login', async (req, res) => {
  try {
    const db = await dbPromise;
    const { email, password } = req.body;

    // Validate required fields
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }

    // Find user by email
    const user = await db.get('SELECT * FROM users WHERE email = ?', [email]);
    
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Check password
    if (user.password !== password) {
      console.log(`[Login] Failed login attempt for email ${email}: Invalid password`);
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    console.log(`[Login] Successful login for user: ${user.email} (${user.role})`);

    res.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed'
    });
  }
});

// Initialize SQLite database with table creation
const initializeDatabase = async () => {
  try {
    const db = await open({
      filename: path.join(__dirname, 'database.db'),
      driver: sqlite3.Database 
    });
    
    // Ensure course_payments table exists
    await ensureTable(db, 'course_payments', `CREATE TABLE course_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      payment_option TEXT NOT NULL,
      bank_name TEXT NOT NULL,
      account_number TEXT NOT NULL,
      account_holder_name TEXT NOT NULL,
      payment_date DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (student_id) REFERENCES users(id)
    )`);
    
    // Ensure course_payment_items table exists
    await ensureTable(db, 'course_payment_items', `CREATE TABLE course_payment_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payment_id INTEGER NOT NULL,
      course_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (payment_id) REFERENCES course_payments(id),
      FOREIGN KEY (course_id) REFERENCES courses(id)
    )`);

    // Ensure contact_messages table exists
    await ensureTable(db, 'contact_messages', `CREATE TABLE contact_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT DEFAULT 'unread',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Utility to ensure a table exists, creating it if not
    async function ensureTable(db, tableName, schema) {
      const table = await db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [tableName]);
      if (!table) {
        await db.exec(schema);
        console.log(`[Database] Created missing table: ${tableName}`);
      }
    }

    // Ensure users table exists
    await ensureTable(db, 'users', `CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      registrationId TEXT UNIQUE,
      name TEXT NOT NULL,
      email TEXT UNIQUE,
      phone TEXT,
      password TEXT NOT NULL,
      role TEXT NOT NULL,
      student_name TEXT,
      student_grade TEXT,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      gender TEXT,
      documents TEXT,
      selected_class TEXT,
      paid BOOLEAN DEFAULT 0
    )`);
    // Ensure gender column exists in users table
    const userColumns = await db.all("PRAGMA table_info(users)");
    const hasGender = userColumns.some(col => col.name === 'gender');
    if (!hasGender) {
      await db.exec('ALTER TABLE users ADD COLUMN gender TEXT');
      console.log('[Database] Added missing gender column to users table');
    }
    // Ensure documents column exists in users table
    const hasDocuments = userColumns.some(col => col.name === 'documents');
    if (!hasDocuments) {
      await db.exec('ALTER TABLE users ADD COLUMN documents TEXT');
      console.log('[Database] Added missing documents column to users table');
    }
    // Ensure classes table exists
    await ensureTable(db, 'classes', `CREATE TABLE classes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL
    )`);    

    // Ensure courses table exists
    await ensureTable(db, 'courses', `CREATE TABLE courses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      price INTEGER NOT NULL,
      bannerPic TEXT,
      schedule TEXT,
      class_id INTEGER,
      FOREIGN KEY (class_id) REFERENCES classes(id)
    )`);
    // Migration: Ensure class_id column exists in courses table
    const columns = await db.all("PRAGMA table_info(courses)");
    const hasClassId = columns.some(col => col.name === 'class_id');
    if (!hasClassId) {
      await db.exec('ALTER TABLE courses ADD COLUMN class_id INTEGER');
      console.log('[Database] Added missing class_id column to courses table');
    }
    // Ensure announcements table exists
    await ensureTable(db, 'announcements', `CREATE TABLE announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      targetRole TEXT NOT NULL,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    // Ensure teacher_enrollments table exists
    await ensureTable(db, 'teacher_enrollments', `CREATE TABLE teacher_enrollments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teacher_id INTEGER NOT NULL,
      course_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (teacher_id) REFERENCES users(id),
      FOREIGN KEY (course_id) REFERENCES courses(id)
    )`);
    // Ensure student_enrollments table exists
    await ensureTable(db, 'student_enrollments', `CREATE TABLE student_enrollments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      course_id INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (student_id) REFERENCES users(id),
      FOREIGN KEY (course_id) REFERENCES courses(id)
    )`);
    // Ensure attendance table exists
    await ensureTable(db, 'attendance', `CREATE TABLE attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      date DATE NOT NULL,
      present BOOLEAN NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (course_id) REFERENCES courses(id),
      FOREIGN KEY (student_id) REFERENCES users(id)
    )`);

    // Ensure grades table exists
    await ensureTable(db, 'grades', `CREATE TABLE grades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      grade INTEGER NOT NULL,
      out_of INTEGER NOT NULL,
      percentage REAL GENERATED ALWAYS AS (CAST(grade AS REAL) / out_of * 100) STORED,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (course_id) REFERENCES courses(id),
      FOREIGN KEY (student_id) REFERENCES users(id)
    )`);

    // Ensure teacher_payments table exists
    await ensureTable(db, 'teacher_payments', `CREATE TABLE teacher_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teacher_id INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      month TEXT NOT NULL,
      year INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (teacher_id) REFERENCES users(id)
    )`);

    // Ensure student_surveys table exists
    await ensureTable(db, 'student_surveys', `CREATE TABLE student_surveys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      teacher_id INTEGER NOT NULL,
      responses TEXT NOT NULL,
      submitted_at DATETIME NOT NULL,
      FOREIGN KEY (student_id) REFERENCES users(id),
      FOREIGN KEY (teacher_id) REFERENCES users(id)
    )`);

    // Ensure orientations table exists
    await ensureTable(db, 'orientations', `CREATE TABLE orientations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      dateTime DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Ensure orientation_enrollments table exists
    await ensureTable(db, 'orientation_enrollments', `CREATE TABLE orientation_enrollments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      orientation_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (orientation_id) REFERENCES orientations(id),
      FOREIGN KEY (student_id) REFERENCES users(id)
    )`);

    // Log all users in the database
    const users = await db.all('SELECT id, name, email, role, status FROM users');
    console.log('[Database] Database initialized successfully');
    console.log('[Database] Current users in database:', JSON.stringify(users, null, 2));
    return db;
  } catch (error) {
    console.error('[Database] Database initialization error:', error);
    throw error;
  }
};

const dbPromise = initializeDatabase();

// Survey endpoints
app.get('/student-teachers/:studentId', async (req, res) => {
  try {
    const db = await dbPromise;
    const teachers = await db.all(`
      SELECT DISTINCT u.id, u.name, c.title as course_name
      FROM users u
      JOIN teacher_enrollments te ON u.id = te.teacher_id
      JOIN courses c ON te.course_id = c.id
      JOIN student_enrollments se ON c.id = se.course_id
      WHERE se.student_id = ? AND u.role = 'teacher'
    `, [req.params.studentId]);
    res.json(teachers);
  } catch (error) {
    console.error('Error fetching teachers:', error);
    res.status(500).json({ error: 'Failed to fetch teachers' });
  }
});

app.post('/submit-survey', async (req, res) => {
  try {
    const db = await dbPromise;
    const { studentId, teacherId, responses } = req.body;

    // Check if survey already exists
    const existingSurvey = await db.get(
      'SELECT id FROM student_surveys WHERE student_id = ? AND teacher_id = ?',
      [studentId, teacherId]
    );

    if (existingSurvey) {
      return res.status(400).json({ message: 'Survey already submitted for this teacher' });
    }

    // Insert survey
    const result = await db.run(
      'INSERT INTO student_surveys (student_id, teacher_id, responses, submitted_at) VALUES (?, ?, ?, datetime("now"))',
      [studentId, teacherId, JSON.stringify(responses)]
    );

    res.json({ success: true, surveyId: result.lastID });
  } catch (error) {
    console.error('Error submitting survey:', error);
    res.status(500).json({ error: 'Failed to submit survey' });
  }
});

app.get('/teacher-surveys/:teacherId', async (req, res) => {
  try {
    const db = await dbPromise;
    const surveys = await db.all(`
      SELECT ss.*, c.title as course_name, u.name as student_name
      FROM student_surveys ss
      JOIN users u ON ss.student_id = u.id
      JOIN teacher_enrollments te ON ss.teacher_id = te.teacher_id
      JOIN courses c ON te.course_id = c.id
      WHERE ss.teacher_id = ?
      ORDER BY ss.submitted_at DESC
    `, [req.params.teacherId]);

    // Parse responses JSON for each survey
    const processedSurveys = surveys.map(survey => ({
      ...survey,
      responses: JSON.parse(survey.responses)
    }));

    res.json(processedSurveys);
  } catch (error) {
    console.error('Error fetching surveys:', error);
    res.status(500).json({ error: 'Failed to fetch surveys' });
  }
});

// Get user by ID endpoint
app.get('/users/:id', async (req, res) => {
  try {
    const db = await dbPromise;
    const user = await db.get('SELECT * FROM users WHERE id = ?', [req.params.id]);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    res.json({
      success: true,
      user
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user'
    });
  }
});

// Student enrollments endpoints
app.get('/students/:studentId/enrollments', async (req, res) => {
  try {
    const db = await dbPromise;
    const enrollments = await db.all(
      `SELECT se.*, c.title, c.description 
       FROM student_enrollments se 
       JOIN courses c ON se.course_id = c.id 
       WHERE se.student_id = ?`,
      [req.params.studentId]
    );
    res.json(enrollments);
  } catch (error) {
    console.error('Error fetching student enrollments:', error);
    res.status(500).json({ error: 'Failed to fetch enrollments' });
  }
});

app.post('/student-enrollments', async (req, res) => {
  try {
    const db = await dbPromise;
    const { studentId, courseId, status } = req.body;
    const result = await db.run(
      'INSERT INTO student_enrollments (student_id, course_id, status) VALUES (?, ?, ?)',
      [studentId, courseId, status]
    );
    res.json({ id: result.lastID });
  } catch (error) {
    console.error('Error creating enrollment:', error);
    res.status(500).json({ error: 'Failed to create enrollment' });
  }
});

app.delete('/student-enrollments/:studentId/:courseId', async (req, res) => {
  try {
    const db = await dbPromise;
    await db.run(
      'DELETE FROM student_enrollments WHERE student_id = ? AND course_id = ?',
      [req.params.studentId, req.params.courseId]
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting enrollment:', error);
    res.status(500).json({ error: 'Failed to delete enrollment' });
  }
});

// Student attendance endpoints
app.get('/students/:studentId/attendance', async (req, res) => {
  try {
    const db = await dbPromise;
    const attendance = await db.all(
      `SELECT a.*, c.title as course_title 
       FROM attendance a 
       JOIN courses c ON a.course_id = c.id 
       WHERE a.student_id = ?`,
      [req.params.studentId]
    );
    res.json(attendance);
  } catch (error) {
    console.error('Error fetching attendance:', error);
    res.status(500).json({ error: 'Failed to fetch attendance' });
  }
});

app.post('/attendance', async (req, res) => {
  try {
    const db = await dbPromise;
    // Handle both single and batch attendance records
    const records = Array.isArray(req.body) ? req.body : [req.body];
    
    // Validate required fields for each record
    for (const record of records) {
      const { course_id, student_id, date, present } = record;
      if (!course_id || !student_id || !date) {
        return res.status(400).json({
          error: 'Missing required fields: course_id, student_id, and date are required'
        });
      }

      console.log(`[Attendance] Incoming date: ${date}`);
      // Use the date string directly without timezone conversion
      const dateString = date;
      console.log(`[Attendance] Normalized date: ${dateString}`);

      // Check if attendance already exists for this date
      const existingAttendance = await db.get(
        'SELECT id FROM attendance WHERE course_id = ? AND student_id = ? AND date = ?',
        [course_id, student_id, dateString]
      );

      if (existingAttendance) {
        return res.status(409).json({
          success: false,
          message: 'Attendance already marked for this date'
        });
      }
    }
    
    // Insert all attendance records with normalized dates
    const results = await Promise.all(
      records.map(record => {
        const normalizedDate = new Date(record.date);
        const dateString = normalizedDate.toISOString().split('T')[0];
        return db.run(
          'INSERT INTO attendance (course_id, student_id, date, present) VALUES (?, ?, ?, ?)',
          [record.course_id, record.student_id, dateString, record.present || false]
        );
      })
    );
    
    res.json({ success: true, message: `${results.length} attendance records created` });
  } catch (error) {
    console.error('Error creating attendance record:', error);
    res.status(500).json({ error: 'Failed to create attendance record' });
  }
});

app.put('/attendance/:id', async (req, res) => {
  try {
    const db = await dbPromise;
    const { present } = req.body;
    await db.run(
      'UPDATE attendance SET present = ? WHERE id = ?',
      [present, req.params.id]
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating attendance:', error);
    res.status(500).json({ error: 'Failed to update attendance' });
  }
});

app.get('/courses/:courseId/students', async (req, res) => {
  try {
    const db = await dbPromise;
    const students = await db.all(
      `SELECT u.id, u.name, u.email 
       FROM users u 
       JOIN student_enrollments se ON u.id = se.student_id 
       WHERE se.course_id = ? AND u.role = 'student' AND se.status = 'approved'`,
      [req.params.courseId]
    );
    res.json(students);
  } catch (error) {
    console.error('Error fetching course students:', error);
    res.status(500).json({ error: 'Failed to fetch students' });
  }
});

// Get teacher's enrolled courses
app.get('/teacher-enrollments/:teacherId/courses', async (req, res) => {
  try {
    const db = await dbPromise;
    const courses = await db.all(
      `SELECT c.*, te.id as enrollment_id 
       FROM courses c
       JOIN teacher_enrollments te ON c.id = te.course_id
       WHERE te.teacher_id = ?`,
      [req.params.teacherId]
    );
    res.json(courses);
  } catch (error) {
    console.error('Error fetching teacher courses:', error);
    res.status(500).json({ error: 'Failed to fetch courses' });
  }
});

// Get teacher enrollments
app.get('/teacher-enrollments/:teacherId', async (req, res) => {
  try {
    const db = await dbPromise;
    const enrollments = await db.all(
      'SELECT * FROM teacher_enrollments WHERE teacher_id = ?',
      [req.params.teacherId]
    );
    res.json(enrollments);
  } catch (error) {
    console.error('Error fetching teacher enrollments:', error);
    res.status(500).json({ error: 'Failed to fetch enrollments' });
  }
});

// Get all courses for teachers
app.get('/courses/teacher', async (req, res) => {
  try {
    const db = await dbPromise;
    const courses = await db.all(
      `SELECT c.*, cl.name as class_name 
       FROM courses c
       LEFT JOIN classes cl ON c.class_id = cl.id`
    );

    if (!courses || courses.length === 0) {
      return res.status(404).json({ error: 'No courses found' });
    }

    // Parse schedule for each course
    const parsedCourses = courses.map(course => {
      if (course.schedule) {
        try {
          course.schedule = JSON.parse(course.schedule);
        } catch (err) {
          console.error(`Failed to parse schedule for course ${course.id}:`, err);
          course.schedule = [];
        }
      } else {
        course.schedule = [];
      }
      return course;
    });

    // Set cache control headers
    res.set('Cache-Control', 'no-cache');
    res.set('ETag', Math.random().toString(36));
    
    res.json(parsedCourses);
  } catch (error) {
    console.error('Error fetching courses:', error);
    res.status(500).json({ error: 'Failed to fetch courses', details: error.message });
  }
});

// Grade management endpoints
app.post('/grades', async (req, res) => {
  try {
    const db = await dbPromise;
    const { course_id, student_id, grade, out_of } = req.body;

    if (!course_id || !student_id || !grade || !out_of) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields'
      });
    }

    const result = await db.run(
      'INSERT INTO grades (course_id, student_id, grade, out_of) VALUES (?, ?, ?, ?)',
      [course_id, student_id, grade, out_of]
    );

    res.json({ success: true, id: result.lastID });
  } catch (error) {
    console.error('Error creating grade:', error);
    res.status(500).json({ error: 'Failed to create grade' });
  }
});

app.get('/courses/:courseId/grades', async (req, res) => {
  try {
    const db = await dbPromise;
    const grades = await db.all(
      `SELECT g.*, u.name as student_name 
       FROM grades g
       JOIN users u ON g.student_id = u.id
       WHERE g.course_id = ?`,
      [req.params.courseId]
    );
    res.json(grades);
  } catch (error) {
    console.error('Error fetching course grades:', error);
    res.status(500).json({ error: 'Failed to fetch grades' });
  }
});

app.get('/students/:studentId/grades', async (req, res) => {
  try {
    const db = await dbPromise;
    const grades = await db.all(
      `SELECT g.*, c.title as course_title 
       FROM grades g
       JOIN courses c ON g.course_id = c.id
       WHERE g.student_id = ?`,
      [req.params.studentId]
    );
    res.json(grades);
  } catch (error) {
    console.error('Error fetching student grades:', error);
    res.status(500).json({ error: 'Failed to fetch grades' });
  }
});

// Get student payments endpoint
app.get('/student-payments', async (req, res) => {
  try {
    console.log('[Student Payments] Request received with query:', req.query);
    const db = await dbPromise;
    const payments = await db.all(
      'SELECT * FROM course_payments WHERE student_id = ?',
      [req.query.studentId]
    );
    console.log('[Student Payments] Retrieved payments:', payments);
    res.json(payments);
  } catch (error) {
    console.error('[Student Payments] Error:', error);
    res.status(500).json({ error: 'Failed to fetch payments' });
  }
});

// Update student payment to mark as full payment
app.post('/student-payments-update', async (req, res) => {
  try {
    const db = await dbPromise;
    const { userId, paymentOption, amount } = req.body;
    
    await db.run(
      'UPDATE course_payments SET payment_option = ?, amount = ? WHERE student_id = ?',
      [paymentOption, amount, userId]
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating payment:', error);
    res.status(500).json({ error: 'Failed to update payment' });
  }
});

// Student course payment endpoint
app.post('/student-course-payment', async (req, res) => {
  try {
    const db = await dbPromise;
    const {
      userId,
      paymentOption,
      bank_name,
      account_number,
      account_holder_name,
      amount,
      date,
      class_id
    } = req.body;

    console.log('[INFO] Received payment request payload:', req.body);

    if (
      !userId || !bank_name || !account_number || !paymentOption ||
      !account_holder_name || !amount || !date
    ) {
      console.warn('[WARN] Missing required fields in request body.');
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: userId, bank_name, account_number, account_holder_name, amount, and date are required'
      });
    }

    // 🔍 Ensure required columns exist in tables
    console.log('[INFO] Checking if required columns exist...');
    
    // Check for all required columns in users and course_payments tables
    const userColumns = await db.all(`PRAGMA table_info(users)`);
    const paymentColumns = await db.all(`PRAGMA table_info(course_payments)`);
    
    // Ensure all required columns exist in users table
    const requiredUserColumns = ['paidClass'];
    for (const col of requiredUserColumns) {
      const exists = userColumns.some(c => c.name === col);
      if (!exists) {
        console.log(`[INFO] Adding ${col} column to users table...`);
        await db.run(`ALTER TABLE users ADD COLUMN ${col} TEXT`);
      }
    }
    
    // Ensure all required columns exist in course_payments table
    const requiredPaymentColumns = ['student_id', 'amount', 'payment_option', 'bank_name', 
                                 'account_number', 'account_holder_name', 'payment_date', 'class_id'];
    for (const col of requiredPaymentColumns) {
      const exists = paymentColumns.some(c => c.name === col);
      if (!exists) {
        const type = col === 'class_id' ? 'INTEGER' : 'TEXT';
        console.log(`[INFO] Adding ${col} column to course_payments table...`);
        await db.run(`ALTER TABLE course_payments ADD COLUMN ${col} ${type}`);
      }
    }

    // ✅ Begin transaction
    console.log('[INFO] Starting database transaction...');
    await db.run('BEGIN TRANSACTION');

    try {
      console.log(`[INFO] Updating user ${userId} with paidClass = ${paymentOption}...`);
      await db.run(
        'UPDATE users SET paidClass = ? WHERE id = ?',
        [paymentOption, userId]
      );
      console.log('[INFO] User updated successfully.');

      console.log('[INFO] Inserting payment record into course_payments...');
      const paymentResult = await db.run(
        'INSERT INTO course_payments (student_id, amount, payment_option, bank_name, account_number, account_holder_name, payment_date, class_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [userId, amount, paymentOption, bank_name, account_number, account_holder_name, date, class_id]
      );
      const paymentId = paymentResult.lastID;
      console.log(`[INFO] Payment record created with ID: ${paymentId}`);

      // Removed enrollments processing as it was causing errors when undefined

      // ✅ Commit transaction
      await db.run('COMMIT');
      console.log('[INFO] Transaction committed successfully.');

      res.json({
        success: true,
        message: 'Payment processed successfully',
        paymentId
      });
    } catch (error) {
      // ❌ Rollback transaction on error
      console.error('[ERROR] Error during transaction. Rolling back...');
      await db.run('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('[ERROR] Error processing course payment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process payment'
    });
  }
});


// Teacher payment endpoints
app.post('/teacher-payments', async (req, res) => {
  try {
    const db = await dbPromise;
    const { teacher_id, amount, month, year } = req.body;

    if (!teacher_id || !amount || !month || !year || isNaN(amount)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payment details'
      });
    }

    const result = await db.run(
      'INSERT INTO teacher_payments (teacher_id, amount, month, year) VALUES (?, ?, ?, ?)',
      [teacher_id, amount, month, year]
    );

    res.json({ success: true, id: result.lastID });
  } catch (error) {
    console.error('Error creating teacher payment:', error);
    res.status(500).json({ error: 'Failed to create payment' });
  }
});

app.get('/teachers/:teacherId/payments', async (req, res) => {
  try {
    const db = await dbPromise;
    const payments = await db.all(
      'SELECT * FROM teacher_payments WHERE teacher_id = ? ORDER BY year DESC, month DESC',
      [req.params.teacherId]
    );
    res.json(payments);
  } catch (error) {
    console.error('Error fetching teacher payments:', error);
    res.status(500).json({ error: 'Failed to fetch payments' });
  }
});

// Orientation endpoints
app.get('/orientations', async (req, res) => {
  try {
    const db = await dbPromise;
    const orientations = await db.all(`
      SELECT o.*, 
        json_group_array(
          json_object(
            'id', oe.id,
            'student', json_object(
              'id', u.id,
              'name', u.name,
              'email', u.email
            )
          )
        ) as enrollments
      FROM orientations o
      LEFT JOIN orientation_enrollments oe ON o.id = oe.orientation_id
      LEFT JOIN users u ON oe.student_id = u.id
      GROUP BY o.id
      ORDER BY o.dateTime DESC
    `);
    res.json(orientations.map(o => ({
      ...o,
      enrollments: JSON.parse(o.enrollments).filter(e => e.student.id !== null)
    })));
  } catch (error) {
    console.error('Error fetching orientations:', error);
    res.status(500).json({ error: 'Failed to fetch orientations' });
  }
});

app.post('/orientations', async (req, res) => {
  try {
    const db = await dbPromise;
    const { title, dateTime } = req.body;
    const result = await db.run(
      'INSERT INTO orientations (title, dateTime) VALUES (?, ?)',
      [title, dateTime]
    );
    res.json({ id: result.lastID });
  } catch (error) {
    console.error('Error creating orientation:', error);
    res.status(500).json({ error: 'Failed to create orientation' });
  }
});

app.get('/orientations/enrollments/:studentId', async (req, res) => {
  try {
    const db = await dbPromise;
    const enrollments = await db.all(
      'SELECT * FROM orientation_enrollments WHERE student_id = ?',
      [req.params.studentId]
    );
    res.json(enrollments);
  } catch (error) {
    console.error('Error fetching orientation enrollments:', error);
    res.status(500).json({ error: 'Failed to fetch enrollments' });
  }
});

app.post('/orientations/:orientationId/enroll', async (req, res) => {
  try {
    const db = await dbPromise;
    const { studentId } = req.body;
    const { orientationId } = req.params;
    
    // Check if already enrolled
    const existing = await db.get(
      'SELECT id FROM orientation_enrollments WHERE orientation_id = ? AND student_id = ?',
      [orientationId, studentId]
    );
    
    if (existing) {
      return res.status(400).json({ error: 'Already enrolled in this orientation' });
    }
    
    const result = await db.run(
      'INSERT INTO orientation_enrollments (orientation_id, student_id) VALUES (?, ?)',
      [orientationId, studentId]
    );
    res.json({ id: result.lastID });
  } catch (error) {
    console.error('Error enrolling in orientation:', error);
    res.status(500).json({ error: 'Failed to enroll in orientation' });
  }
});

app.delete('/orientations/:orientationId/drop/:studentId', async (req, res) => {
  try {
    const db = await dbPromise;
    await db.run(
      'DELETE FROM orientation_enrollments WHERE orientation_id = ? AND student_id = ?',
      [req.params.orientationId, req.params.studentId]
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Error dropping from orientation:', error);
    res.status(500).json({ error: 'Failed to drop from orientation' });
  }
});

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

// Delete attendance record
app.delete('/attendance/:id', async (req, res) => {
  try {
    const db = await dbPromise;
    const { id } = req.params;

    // First check if the attendance record exists
    const existingRecord = await db.get('SELECT id FROM attendance WHERE id = ?', [id]);

    if (!existingRecord) {
      return res.status(404).json({ success: false, message: 'Attendance record not found' });
    }

    // Delete the attendance record
    await db.run('DELETE FROM attendance WHERE id = ?', [id]);

    res.json({ success: true, message: 'Attendance record deleted successfully' });
  } catch (error) {
    console.error('Error deleting attendance record:', error);
    res.status(500).json({ success: false, message: 'Failed to delete attendance record' });
  }
});

// Get application status
app.get('/application-status/:studentId', async (req, res) => {
  try {
    const db = await dbPromise;
    const { studentId } = req.params;
    const user = await db.get('SELECT status, paid, documents,paidClass FROM users WHERE id = ?', [studentId]);
    res.json({
      status: user?.status || 'pending',
      paid: user?.paid || false,
      documents: user?.documents || '',
      paidClass: user?.paidClass || ''
    });
  } catch (error) {
    console.error('Error checking application status:', error);
    res.status(500).json({ error: 'Failed to check application status' });
  }
});

// Get courses by class ID
app.get('/classes/:id/courses', async (req, res) => {
  try {
    const db = await dbPromise;
    const courses = await db.all(
      `SELECT c.*, cl.name as class_name 
       FROM courses c
       LEFT JOIN classes cl ON c.class_id = cl.id
       WHERE c.class_id = ?`,
      [req.params.id]
    );

    // Parse schedule for each course if it exists
    const parsedCourses = courses.map(course => {
      if (course.schedule) {
        try {
          course.schedule = JSON.parse(course.schedule);
        } catch (err) {
          console.error(`Failed to parse schedule for course ${course.id}:`, err);
          course.schedule = [];
        }
      } else {
        course.schedule = [];
      }
      return course;
    });

    res.json(parsedCourses);
  } catch (error) {
    console.error('Error fetching class courses:', error);
    res.status(500).json({ error: 'Failed to fetch courses' });
  }
});

// Get student's class
app.get('/students/:id/class', async (req, res) => {
  try {
    const db = await dbPromise;
    const { id } = req.params;
    
    // Get student's selected class from users table
    const student = await db.get('SELECT selected_class FROM users WHERE id = ?', [id]);
    
    if (!student || !student.selected_class) {
      return res.status(404).json({ error: 'No class found for this student' });
    }
    
    // Get class details
    const classDetails = await db.get('SELECT * FROM classes WHERE id = ?', [student.selected_class]);
    
    if (!classDetails) {
      return res.status(404).json({ error: 'Class not found' });
    }
    
    res.json(classDetails);
  } catch (error) {
    console.error('Error fetching student class:', error);
    res.status(500).json({ error: 'Failed to fetch class details' });
  }
});



// Get student's attendance
app.get('/students/:id/attendance', async (req, res) => {
  try {
    const db = await dbPromise;
    const { id } = req.params;
    
    const attendance = await db.all(`
      SELECT a.*, c.title as course_title
      FROM attendance a
      JOIN courses c ON a.course_id = c.id
      WHERE a.student_id = ?
      ORDER BY a.date DESC
    `, [id]);

    res.json(attendance);
  } catch (error) {
    console.error('[Attendance] Error fetching student attendance:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch attendance' });
  }
});

// Get course by ID
app.get('/courses/:id', async (req, res) => {
  try {
    const db = await dbPromise;
    const course = await db.get(
      `SELECT c.*, cl.name as class_name 
       FROM courses c
       LEFT JOIN classes cl ON c.class_id = cl.id
       WHERE c.id = ?`,
      [req.params.id]
    );
    
    if (!course) {
      return res.status(404).json({
        success: false,
        message: 'Course not found'
      });
    }

    // Parse schedule if it exists
    if (course.schedule) {
      try {
        course.schedule = JSON.parse(course.schedule);
      } catch (err) {
        console.error(`Failed to parse schedule for course ${course.id}:`, err);
        course.schedule = [];
      }
    }

    res.json(course);
  } catch (error) {
    console.error('Error fetching course:', error);
    res.status(500).json({ error: 'Failed to fetch course' });
  }
});

// Registration endpoint
app.post('/register', async (req, res) => {
  try {
    const db = await dbPromise;
    const {
      name,
      email,
      phone,
      password,
      role,
      studentName,
      studentGrade,
      registrationId,
      gender,
      documents,
      selectedClass
    } = req.body;

    console.log('[Registration] Received gender:', gender);
    console.log('[Registration] Full request body:', req.body);

    // Validate required fields
    const requiredFieldsPresent = name && email && password && role && registrationId;
    console.log('[Registration] Required fields present:', requiredFieldsPresent);
    if (!requiredFieldsPresent) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email format'
      });
    }

    // Check if email already exists
    const existingUser = await db.get('SELECT email FROM users WHERE email = ?', [email]);
    console.log('[Registration] Existing user:', existingUser);
    if (existingUser) {
      console.log(`Registration attempt with existing email: ${email}`);
      return res.status(409).json({
        success: false,
        message: 'This email is already registered'
      });
    }

    // Dynamically add missing columns
    const userColumns = await db.all("PRAGMA table_info(users)");
    const existingColumnNames = userColumns.map(col => col.name);
    for (const key of Object.keys(req.body)) {
      if (!existingColumnNames.includes(key)) {
        // Infer type: if value is number, use INTEGER, if boolean, use BOOLEAN, else TEXT
        let type = 'TEXT';
        const value = req.body[key];
        if (typeof value === 'number') type = 'INTEGER';
        else if (typeof value === 'boolean') type = 'BOOLEAN';
        await db.exec(`ALTER TABLE users ADD COLUMN ${key} ${type}`);
        console.log(`[Registration] Added missing column '${key}' of type ${type} to users table`);
      }
    }

    // Prepare insert statement dynamically
    const insertFields = Object.keys(req.body);
    const insertValues = insertFields.map(f => req.body[f]);
    const placeholders = insertFields.map(() => '?').join(', ');
    const insertSQL = `INSERT INTO users (${insertFields.join(', ')}) VALUES (${placeholders})`;
    await db.run(insertSQL, insertValues);

    res.status(201).json({
      success: true,
      registrationId
    });
  } catch (error) {
    console.error('[Registration] Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Registration failed',
      error: error.message
    });
  }
})

// Get pending registrations
app.get('/registrations/pending', async (req, res) => {
  try {
    const db = await dbPromise;
    const rows = await db.all('SELECT * FROM users WHERE status = ?', ['pending']);
    
    // Set cache control headers
    res.set('Cache-Control', 'no-cache');
    res.set('ETag', Math.random().toString(36));
    
    res.json(rows);
  } catch (error) {
    console.error('[Registration] Error fetching pending registrations:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pending registrations',
      details: error.message
    });
  }
});

// Get approved registrations
app.get('/registrations/approved', async (req, res) => {
  try {
    const db = await dbPromise;
    const rows = await db.all('SELECT * FROM users WHERE status = ?', ['approved']);
    res.json(rows);
  } catch (error) {
    console.error('[Registration] Error fetching approved registrations:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch approved registrations'
    });
  }
});

// Update registration status
app.put('/registrations/:id/status', async (req, res) => {
  const { id: registrationId } = req.params;
  const { status } = req.body;

  console.log(`[Update Status] Received request. registrationId=${registrationId}, status=${status}`);

  // Validate status field
  if (!status || (status !== 'approved' && status !== 'rejected')) {
    console.error(`[Update Status] Invalid status provided: ${status}`);
    return res.status(400).json({
      success: false,
      message: "Invalid status. Must be 'approved' or 'rejected'."
    });
  }

  try {
    const db = await dbPromise;

    // Fetch user by registrationId
    const user = await db.get(
      `SELECT * FROM users WHERE registrationId = ?`,
      [registrationId]
    );
    if (!user) {
      console.warn(`[Update Status] No user found for registrationId=${registrationId}`);
      return res.status(404).json({
        success: false,
        message: 'User not found for given registrationId.'
      });
    }
    console.log(`[Update Status] Found user: id=${user.id}, role=${user.role}, selected_class=${user.selected_class}, current status=${user.status}`);

    // Update the user's status
    await db.run(
      `UPDATE users SET status = ? WHERE registrationId = ?`,
      [status, registrationId]
    );
    console.log(`[Update Status] Updated user.status to '${status}' for user.id=${user.id}`);

    // If approved and user is a student, enroll in courses
    if (status === 'approved') {
      if (user.role !== 'student') {
        console.log(`[Update Status] User id=${user.id} is not a student (role=${user.role}); skipping enrollment.`);
      } else if (!user.selected_class) {
        console.warn(`[Update Status] User id=${user.id} has no selected_class; cannot enroll in courses.`);
      } else {
        // Fetch all courses for the student's selected_class
        const courses = await db.all(
          `SELECT id FROM courses WHERE class_id = ?`,
          [user.selected_class]
        );
        console.log(`[Update Status] Found ${courses.length} course(s) for class_id='${user.selected_class}'`);

        for (const course of courses) {
          const alreadyEnrolled = await db.get(
            `SELECT id FROM student_enrollments WHERE student_id = ? AND course_id = ?`,
            [user.id, course.id]
          );
          if (alreadyEnrolled) {
            console.log(`[Update Status] Student id=${user.id} already enrolled in course id=${course.id}; skipping.`);
          } else {
            await db.run(
              `INSERT INTO student_enrollments (student_id, course_id, status) VALUES (?, ?, ?)`,
              [user.id, course.id, 'approved']
            );
            console.log(`[Update Status] Enrolled student id=${user.id} in course id=${course.id}`);
          }
        }

        if (courses.length === 0) {
          console.warn(`[Update Status] No courses found to enroll for class_id='${user.selected_class}'.`);
        }
      }
    }
    // If rejected, delete related data and the user
    else if (status === 'rejected') {
      console.log(`[Update Status] User id=${user.id} will be rejected and related data deleted.`);
      if (user.role === 'student') {
        await db.run(
          `DELETE FROM student_enrollments WHERE student_id = ?`,
          [user.id]
        );
        console.log(`[Update Status] Deleted student_enrollments for student_id=${user.id}`);
        await db.run(
          `DELETE FROM attendance WHERE student_id = ?`,
          [user.id]
        );
        console.log(`[Update Status] Deleted attendance records for student_id=${user.id}`);
      } else if (user.role === 'teacher') {
        await db.run(
          `DELETE FROM teacher_enrollments WHERE teacher_id = ?`,
          [user.id]
        );
        console.log(`[Update Status] Deleted teacher_enrollments for teacher_id=${user.id}`);
      }
      await db.run(
        `DELETE FROM users WHERE id = ?`,
        [user.id]
      );
      console.log(`[Update Status] Deleted user id=${user.id} from users table.`);
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('[Update Status] Error while processing:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update registration status due to server error.'
    });
  }
});


// Check application status endpoint
app.get('/application-status/:studentId', async (req, res) => {
  try {
    const db = await dbPromise;
    const student = await db.get('SELECT status, paid, selected_class, paidClass FROM users WHERE id = ?', [req.params.studentId]);
    
    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }
    
    res.json({
      status: student.status || 'pending',
      paid: student.paid === 1 || student.paid === 'ok',
      selected_class: student.selected_class,
      paidClass: student.paidClass
    });
  } catch (error) {
    console.error('Error checking application status:', error);
    res.status(500).json({ error: 'Failed to check application status' });
  }
});

// Student Application Details API
import multer from 'multer';
import fs from 'fs';
import util from 'util';

const upload = multer();

app.post('/student-application', upload.any(), async (req, res) => {
  try {
    const db = await dbPromise;
    // Support both JSON and multipart/form-data
    let data = req.body;
    let fileBuffer = null;
    let fileName = null;

    if (req.files && req.files.length > 0) {
      // Find the documents file field
      const file = req.files.find(f => f.fieldname === 'documents');
      if (file) {
        fileBuffer = file.buffer;
        fileName = file.originalname;
        data.documents = fileBuffer ? fileBuffer.toString('base64') : null;
      }
    }

    const {
      userId,
      selected_class,
      bank_name,
      account_number,
      account_holder_name,
      registration_fee,
      documents
    } = data;

    console.log('userId:', userId);
    console.log('selected_class:', selected_class);
    console.log('bank_name:', bank_name);
    console.log('account_number:', account_number);
    console.log('account_holder_name:', account_holder_name);
    console.log('registration_fee:', registration_fee);
    console.log('documents (base64):', documents);

    // Validate required fields
    if (
      !userId ||
      !selected_class ||
      !documents ||
      !bank_name ||
      !account_number ||
      !account_holder_name ||
      !registration_fee
    ) {
      return res.status(400).json({
        success: false,
        message: 'All fields are required'
      });
    }

    // Dynamically add missing columns
    const userColumns = await db.all("PRAGMA table_info(users)");
    const existingColumnNames = userColumns.map(col => col.name);

    const requiredFields = [
      { key: 'selected_class', type: 'TEXT' },
      { key: 'documents', type: 'TEXT' },
      { key: 'bank_name', type: 'TEXT' },
      { key: 'account_number', type: 'TEXT' },
      { key: 'account_holder_name', type: 'TEXT' },
      { key: 'registration_fee', type: typeof registration_fee === 'number' ? 'INTEGER' : 'TEXT' }
    ];

    for (const field of requiredFields) {
      if (!existingColumnNames.includes(field.key)) {
        await db.exec(`ALTER TABLE users ADD COLUMN ${field.key} ${field.type}`);
      }
    }

    // Ensure 'paid' and 'status' columns exist
    if (!existingColumnNames.includes('paid')) {
      await db.exec(`ALTER TABLE users ADD COLUMN paid TEXT`);
    }
    if (!existingColumnNames.includes('status')) {
      await db.exec(`ALTER TABLE users ADD COLUMN status TEXT`);
    }

    // Update user with application details
    await db.run(
      `UPDATE users SET 
         selected_class = ?,
         documents = ?,
         bank_name = ?,
         account_number = ?,
         account_holder_name = ?,
         registration_fee = ?,
         paid = 'ok',
         status = 'pending'
       WHERE id = ?`,
      [
        selected_class,
        documents,
        bank_name,
        account_number,
        account_holder_name,
        registration_fee,
        userId
      ]
    );

    res.status(200).json({
      success: true,
      message: 'Application submitted successfully. Please wait for admin approval.'
    });
  } catch (error) {
    console.error('Error submitting application:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit application'
    });
  }
});


// Teacher Application Details API
app.post('/teacher-application', async (req, res) => {
  try {
    const db = await dbPromise;
    const { userId, document } = req.body;

    console.log('[Teacher Application] Received request:', userId);

    if (!userId || !document) {
      return res.status(400).json({
        success: false,
        message: 'User ID and document are required',
      });
    }

    // Validate document is base64 string
    if (typeof document !== 'string' || !document.match(/^[A-Za-z0-9+/]+={0,2}$/)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid document format',
      });
    }

    // Update teacher's document field
    await db.run(
      'UPDATE users SET documents = ?, status = ? WHERE id = ?',
      [document, 'pending', userId]
    );

    console.log(`[Teacher Application] Documents updated for teacher ${userId}`);

    res.status(200).json({
      success: true,
      message: 'Application submitted successfully. Please wait for admin approval.',
    });

  } catch (error) {
    console.error('Error submitting application:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit application',
    });
  }
});


// Check Application Status
app.get('/application-status/:userId', async (req, res) => {
  try {
    const db = await dbPromise;
    const { userId } = req.params;

    const user = await db.get('SELECT status FROM users WHERE id = ?', [userId]);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
console.log(user.paid)
    res.json({
      success: true,
      status: user.status,
      paid:user.paid,
    });
  } catch (error) {
    console.error('Error checking application status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check application status'
    });
  }
});

// Delete registration
app.delete('/registrations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const db = await dbPromise;
    
    // Check if registration exists
    const registration = await db.get('SELECT * FROM users WHERE registrationId = ?', [id]);
    if (!registration) {
      return res.status(404).json({
        success: false,
        message: 'Registration not found'
      });
    }
    
    await db.run('DELETE FROM users WHERE registrationId = ?', [id]);
    res.json({ success: true });
  } catch (error) {
    console.error('[Registration] Error deleting registration:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete registration'
    });
  }
});

// Contact form submission endpoint
app.post('/contact', async (req, res) => {
  try {
    const db = await dbPromise;
    const { name, email, phone, message } = req.body;

    // Validate required fields
    if (!name || !email || !phone || !message) {
      return res.status(400).json({
        success: false,
        message: 'All fields are required'
      });
    }

    // Insert contact message
    await db.run(
      'INSERT INTO contact_messages (name, email, phone, message) VALUES (?, ?, ?, ?)',
      [name, email, phone, message]
    );

    res.status(201).json({
      success: true,
      message: 'Message sent successfully'
    });
  } catch (error) {
    console.error('[Contact] Error saving contact message:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send message'
    });
  }
});

// Get contact messages endpoint (admin only)
app.get('/contact-messages', async (req, res) => {
  try {
    const db = await dbPromise;
    const messages = await db.all('SELECT * FROM contact_messages ORDER BY created_at DESC');
    res.json(messages);
  } catch (error) {
    console.error('[Contact] Error fetching contact messages:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch contact messages'
    });
  }
});

// Update contact message status endpoint (admin only)
app.put('/contact-messages/:id/status', async (req, res) => {
  try {
    const db = await dbPromise;
    const { id } = req.params;
    const { status } = req.body;

    if (!['read', 'unread'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status value'
      });
    }

    await db.run('UPDATE contact_messages SET status = ? WHERE id = ?', [status, id]);
    res.json({ success: true });
  } catch (error) {
    console.error('[Contact] Error updating message status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update message status'
    });
  }
});

// Create a new course
app.post('/courses', async (req, res) => {
  try {
    const db = await dbPromise;
    const { title, description, price, bannerPic, schedule } = req.body;
    if (!title || !description || !price || !bannerPic || !schedule) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }
    await db.run(
      `INSERT INTO courses (title, description, price, bannerPic, schedule) VALUES (?, ?, ?, ?, ?)`,
      [title, description, price, bannerPic, JSON.stringify(schedule)]
    );
    res.status(201).json({ success: true });
  } catch (error) {
    console.error('[Courses] Error creating course:', error);
    res.status(500).json({ success: false, message: 'Failed to create course' });
  }
});

// Create a new course within a specific class
app.post('/classes/:classId/courses', async (req, res) => {
  try {
    const db = await dbPromise;
    const { classId } = req.params;
    const { title, description, price, bannerPic, schedule, courseId } = req.body;
    
    // If courseId is provided, assign existing course to class
    if (courseId) {
      // Check if class exists
      const classExists = await db.get('SELECT id FROM classes WHERE id = ?', [classId]);
      if (!classExists) {
        return res.status(404).json({ success: false, message: 'Class not found' });
      }
      // Check if course exists
      const courseExists = await db.get('SELECT id FROM courses WHERE id = ?', [courseId]);
      if (!courseExists) {
        return res.status(404).json({ success: false, message: 'Course not found' });
      }
      // Assign course to class
      await db.run('UPDATE courses SET class_id = ? WHERE id = ?', [classId, courseId]);
      return res.status(200).json({ success: true });
    }
    
    // Otherwise, create a new course in the class
    if (!title || !description || !price || !bannerPic || !schedule) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }
    // Check if class exists
    const classExists = await db.get('SELECT id FROM classes WHERE id = ?', [classId]);
    if (!classExists) {
      return res.status(404).json({ success: false, message: 'Class not found' });
    }
    await db.run(
      `INSERT INTO courses (title, description, price, bannerPic, schedule, class_id) VALUES (?, ?, ?, ?, ?, ?)`,
      [title, description, price, bannerPic, JSON.stringify(schedule), classId]
    );
    
    res.status(201).json({ success: true });
  } catch (error) {
    console.error('[Courses] Error creating course:', error);
    res.status(500).json({ success: false, message: 'Failed to create course' });
  }
});

// Remove a course from a class
app.delete('/classes/:classId/courses/:courseId', async (req, res) => {
  try {
    const db = await dbPromise;
    const { classId, courseId } = req.params;
    // Check if class exists
    const classExists = await db.get('SELECT id FROM classes WHERE id = ?', [classId]);
    if (!classExists) {
      return res.status(404).json({ success: false, message: 'Class not found' });
    }
    // Check if course exists and is assigned to this class
    const course = await db.get('SELECT * FROM courses WHERE id = ? AND class_id = ?', [courseId, classId]);
    if (!course) {
      return res.status(404).json({ success: false, message: 'Course not found in this class' });
    }
    // Remove the association
    await db.run('UPDATE courses SET class_id = NULL WHERE id = ?', [courseId]);
    res.status(204).send();
  } catch (error) {
    console.error('[Classes] Error removing course from class:', error);
    res.status(500).json({ success: false, message: 'Failed to remove course from class' });
  }
});

// Classes API endpoints
app.get('/classes', async (req, res) => {
  try {
    const db = await dbPromise;
    // Fetch all classes
    const classes = await db.all('SELECT * FROM classes');
    // Fetch all courses
    const courses = await db.all('SELECT * FROM courses');
    // Map courses to their classes
    const classesWithCourses = classes.map(classItem => ({
      ...classItem,
      courses: courses.filter(course => course.class_id === classItem.id).map(course => ({ id: course.id, title: course.title }))
    }));
    res.json(classesWithCourses);
  } catch (error) {
    console.error('[Classes] Error fetching classes:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch classes' });
  }
});

app.post('/classes', async (req, res) => {
  try {
    const db = await dbPromise;
    const { name } = req.body;
    
    if (!name) {
      return res.status(400).json({ success: false, message: 'Class name is required' });
    }
    
    await db.run('INSERT INTO classes (name) VALUES (?)', [name]);
    res.status(201).json({ success: true });
  } catch (error) {
    console.error('[Classes] Error creating class:', error);
    res.status(500).json({ success: false, message: 'Failed to create class' });
  }
});

app.delete('/classes/:id', async (req, res) => {
  try {
    const db = await dbPromise;
    const { id } = req.params;
    
    // Begin transaction
    await db.run('BEGIN TRANSACTION');
    
    try {
      // First check if the class exists
      const classExists = await db.get('SELECT id FROM classes WHERE id = ?', [id]);
      if (!classExists) {
        await db.run('ROLLBACK');
        return res.status(404).json({ success: false, message: 'Class not found' });
      }

      // Check if class_id column exists in courses table
      const columns = await db.all("PRAGMA table_info(courses)");
      const hasClassIdColumn = columns.some(col => col.name === 'class_id');
      
      // If class_id column exists, update associated courses
      if (hasClassIdColumn) {
        const associatedCourses = await db.all('SELECT id FROM courses WHERE class_id = ?', [id]);
        if (associatedCourses.length > 0) {
          await db.run('UPDATE courses SET class_id = NULL WHERE class_id = ?', [id]);
        }
      }
      
      // Delete the class
      const result = await db.run('DELETE FROM classes WHERE id = ?', [id]);
      
      // Commit transaction
      await db.run('COMMIT');
      
      if (result.changes === 0) {
        return res.status(404).json({ success: false, message: 'Class not found' });
      }
      
      res.json({ success: true });
    } catch (error) {
      // Rollback on error
      await db.run('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('[Classes] Error deleting class:', error);
    res.status(500).json({ success: false, message: 'Failed to delete class' });
  }
});

// Delete course endpoint
app.delete('/courses/:id', async (req, res) => {
  try {
    const db = await dbPromise;
    const { id } = req.params;
    
    // Delete the course
    await db.run('DELETE FROM courses WHERE id = ?', [id]);
    
    res.json({ success: true });
  } catch (error) {
    console.error('[Courses] Error deleting course:', error);
    res.status(500).json({ success: false, message: 'Failed to delete course' });
  }
});

// Get all courses
app.get('/courses', async (req, res) => {
  try {
    const db = await dbPromise;
    const rows = await db.all('SELECT * FROM courses');
    // Parse schedule JSON for each course
    const courses = rows.map(row => ({
      ...row,
      schedule: row.schedule ? JSON.parse(row.schedule) : []
    }));
    res.json(courses);
  } catch (error) {
    console.error('[Courses] Error fetching courses:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch courses' });
  }
});

// Get all courses with teacher enrollment status
app.get('/courses/teacher', async (req, res) => {
  try {
    const db = await dbPromise;
    // Get all courses
    const courses = await db.all('SELECT c.*, cl.name as class_name FROM courses c LEFT JOIN classes cl ON c.class_id = cl.id');
    // Get all teacher enrollments
    const enrollments = await db.all('SELECT * FROM teacher_enrollments');
    // Map course id to enrolled teacher ids
    const courseIdToTeacherIds = {};
    enrollments.forEach(e => {
      if (!courseIdToTeacherIds[e.course_id]) courseIdToTeacherIds[e.course_id] = [];
      courseIdToTeacherIds[e.course_id].push(e.teacher_id);
    });
    // Attach class_name and enrolledTeachers to each course
    const result = courses.map(course => ({
      id: course.id,
      title: course.title,
      description: course.description,
      schedule: course.schedule ? JSON.parse(course.schedule) : [],
      class_id: course.class_id,
      class_name: course.class_name,
      enrolledTeachers: courseIdToTeacherIds[course.id] || []
    }));
    res.json(result);
  } catch (error) {
    console.error('[Courses] Error fetching teacher courses:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch teacher courses' });
  }
});

// Get all enrollments (students and teachers) for a course
app.get('/courses/:id/enrollments', async (req, res) => {
  try {
    const db = await dbPromise;
    const courseId = req.params.id;
    // Get student enrollments
    const students = await db.all(`SELECT u.id, u.name, u.email, u.role, 'student' as enrollmentType FROM users u JOIN student_enrollments se ON u.id = se.student_id WHERE se.course_id = ?`, [courseId]);
    // Get teacher enrollments
    const teachers = await db.all(`SELECT u.id, u.name, u.email, u.role, 'teacher' as enrollmentType FROM users u JOIN teacher_enrollments te ON u.id = te.teacher_id WHERE te.course_id = ?`, [courseId]);
    res.json([...students, ...teachers]);
  } catch (error) {
    console.error('[Enrollments] Error fetching enrollments:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch enrollments' });
  }
});

// Remove a user (student or teacher) from a course
app.delete('/courses/:courseId/enrollments/:userId', async (req, res) => {
  try {
    const db = await dbPromise;
    const { courseId, userId } = req.params;
    // Check user role
    const user = await db.get('SELECT role FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    if (user.role === 'teacher') {
      await db.run('DELETE FROM teacher_enrollments WHERE teacher_id = ? AND course_id = ?', [userId, courseId]);
    } else {
      await db.run('DELETE FROM student_enrollments WHERE student_id = ? AND course_id = ?', [userId, courseId]);
    }
    res.json({ success: true });
  } catch (error) {
    console.error('[Enrollments] Error removing enrollment:', error);
    res.status(500).json({ success: false, message: 'Failed to remove enrollment' });
  }
});

// Announcements API
// Get all announcements
app.get('/announcements', async (req, res) => {
  try {
    const db = await dbPromise;
    const rows = await db.all('SELECT * FROM announcements ORDER BY createdAt DESC');
    res.json(rows);
  } catch (error) {
    console.error('[Announcements] Error fetching announcements:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch announcements' });
  }
});

// Create announcement
app.post('/announcements', async (req, res) => {
  try {
    const db = await dbPromise;
    const { title, message, targetRole } = req.body;
    if (!title || !message || !targetRole) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }
    const result = await db.run(
      `INSERT INTO announcements (title, message, targetRole) VALUES (?, ?, ?)`,
      [title, message, targetRole]
    );
    res.status(201).json({ success: true, id: result.lastID });
  } catch (error) {
    console.error('[Announcements] Error creating announcement:', error);
    res.status(500).json({ success: false, message: 'Failed to create announcement' });
  }
});

// Delete announcement
app.delete('/announcements/:id', async (req, res) => {
  try {
    const db = await dbPromise;
    const { id } = req.params;
    const result = await db.run('DELETE FROM announcements WHERE id = ?', [id]);
    if (result.changes === 0) {
      return res.status(404).json({ success: false, message: 'Announcement not found' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('[Announcements] Error deleting announcement:', error);
    res.status(500).json({ success: false, message: 'Failed to delete announcement' });
  }
});

// Teacher course enrollment
// Teacher enrollment endpoint
app.post('/teacher-enrollments', async (req, res) => {
  try {
    const db = await dbPromise;
    const { teacherId, courseId } = req.body;

    // Validate required fields
    if (!teacherId || !courseId) {
      return res.status(400).json({
        success: false,
        message: 'Teacher ID and Course ID are required'
      });
    }

    // Check if teacher exists and has teacher role
    const teacher = await db.get('SELECT * FROM users WHERE id = ? AND role = ?', [teacherId, 'teacher']);
    if (!teacher) {
      return res.status(404).json({
        success: false,
        message: 'Teacher not found or user is not a teacher'
      });
    }

    // Check if course exists
    const course = await db.get('SELECT * FROM courses WHERE id = ?', [courseId]);
    if (!course) {
      return res.status(404).json({
        success: false,
        message: 'Course not found'
      });
    }

    // Check if teacher is already enrolled in this course
    const existingEnrollment = await db.get(
      'SELECT * FROM teacher_enrollments WHERE teacher_id = ? AND course_id = ?',
      [teacherId, courseId]
    );

    if (existingEnrollment) {
      return res.status(409).json({
        success: false,
        message: 'Teacher is already enrolled in this course'
      });
    }

    // Create new enrollment
    await db.run(
      'INSERT INTO teacher_enrollments (teacher_id, course_id) VALUES (?, ?)',
      [teacherId, courseId]
    );

    res.status(201).json({
      success: true,
      message: 'Teacher enrolled successfully'
    });
  } catch (error) {
    console.error('[Teacher Enrollments] Error enrolling teacher:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to enroll teacher'
    });
  }
});

// Get all courses a teacher is enrolled in
app.get('/teacher-enrollments/:teacherId', async (req, res) => {
  try {
    const db = await dbPromise;
    const teacherId = req.params.teacherId;
    const enrollments = await db.all('SELECT * FROM teacher_enrollments WHERE teacher_id = ?', [teacherId]);
    res.json(enrollments);
  } catch (error) {
    console.error('[Teacher Enrollments] Error fetching enrollments:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch teacher enrollments'
    });
  }
});

// Delete a teacher's enrollment in a course
app.delete('/teacher-enrollments/:teacherId/:courseId', async (req, res) => {
  try {
    const db = await dbPromise;
    const { teacherId, courseId } = req.params;
    const result = await db.run('DELETE FROM teacher_enrollments WHERE teacher_id = ? AND course_id = ?', [teacherId, courseId]);
    if (result.changes === 0) {
      return res.status(404).json({ success: false, message: 'Enrollment not found' });
    }
    res.json({ success: true, message: 'Enrollment deleted' });
  } catch (error) {
    console.error('[Teacher Enrollments] Error deleting enrollment:', error);
    res.status(500).json({ success: false, message: 'Failed to delete enrollment' });
  }
});

// Get all courses a teacher is enrolled in (with course details)
app.get('/teacher-enrollments/:teacherId/courses', async (req, res) => {
  try {
    const db = await dbPromise;
    const teacherId = req.params.teacherId;
    const courses = await db.all(`
      SELECT c.* FROM courses c
      JOIN teacher_enrollments te ON c.id = te.course_id
      WHERE te.teacher_id = ?
    `, [teacherId]);
    res.json(courses);
  } catch (error) {
    console.error('[Teacher Enrollments] Error fetching teacher courses:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch teacher courses' });
  }
});

// Get students enrolled in a course
app.get('/courses/:id/students', async (req, res) => {
  try {
    const db = await dbPromise;
    const courseId = req.params.id;
    
    const students = await db.all(`
      SELECT u.id, u.name, u.email, se.status
      FROM users u
      JOIN student_enrollments se ON u.id = se.student_id
      WHERE se.course_id = ? AND se.status = 'approved'
    `, [courseId]);
    
    res.json(students);
  } catch (error) {
    console.error('[Course Students] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch students'
    });
  }
});

// Submit attendance
app.post('/attendance', async (req, res) => {
  try {
    const db = await dbPromise;
    const { courseId, date, attendance } = req.body;
    
    // Begin transaction
    await db.run('BEGIN TRANSACTION');
    
    try {
      for (const record of attendance) {
        await db.run(
          'INSERT INTO attendance (course_id, student_id, date, present) VALUES (?, ?, ?, ?)',
          [courseId, record.studentId, date, record.present]
        );
      }
      
      await db.run('COMMIT');
      res.json({ success: true });
    } catch (error) {
      await db.run('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('[Attendance] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit attendance'
    });
  }
});

// Get student attendance
app.get('/students/:id/attendance', async (req, res) => {
  try {
    const db = await dbPromise;
    const studentId = req.params.id;
    const attendance = await db.all(`
      SELECT a.*, c.title as courseTitle
      FROM attendance a
      JOIN courses c ON a.course_id = c.id
      WHERE a.student_id = ?
      ORDER BY a.date DESC
    `, [studentId]);
    res.json(attendance);
  } catch (error) {
    console.error('[Student Attendance] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch attendance'
    });
  }
});

// Get course attendance
app.get('/courses/:courseId/attendance', async (req, res) => {
  try {
    const db = await dbPromise;
    const { courseId } = req.params;
    const attendance = await db.all('SELECT * FROM attendance WHERE course_id = ?', [courseId]);
    res.json(attendance);
  } catch (error) {
    console.error('[Attendance] Error fetching attendance:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch attendance', attendance: [] });
  }
});

// Student course enrollment
app.post('/student-enrollments', async (req, res) => {
  try {
    const db = await dbPromise;
    const { studentId, courseId } = req.body;
    
    // Check if already enrolled
    const existing = await db.get(
      'SELECT * FROM student_enrollments WHERE student_id = ? AND course_id = ?',
      [studentId, courseId]
    );
    
    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'Already enrolled in this course'
      });
    }
    
    await db.run(
      'INSERT INTO student_enrollments (student_id, course_id) VALUES (?, ?)',
      [studentId, courseId]
    );
    
    res.status(201).json({ success: true });
  } catch (error) {
    console.error('[Student Enrollment] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to enroll in course'
    });
  }
});

// Get student's enrolled courses
app.get('/students/:id/courses', async (req, res) => {
  try {
    const db = await dbPromise;
    const studentId = req.params.id;
    
    const courses = await db.all(`
      SELECT c.*, se.status
      FROM courses c
      JOIN student_enrollments se ON c.id = se.course_id
      WHERE se.student_id = ?
    `, [studentId]);
    
    res.json(courses);
  } catch (error) {
    console.error('[Student Courses] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch courses'
    });
  }
});

// Get teacher's enrolled courses
app.get('/teachers/:id/courses', async (req, res) => {
  try {
    const db = await dbPromise;
    const teacherId = req.params.id;
    
    const courses = await db.all(`
      SELECT c.*
      FROM courses c
      JOIN teacher_enrollments te ON c.id = te.course_id
      WHERE te.teacher_id = ?
    `, [teacherId]);
    
    res.json(courses);
  } catch (error) {
    console.error('[Teacher Courses] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch courses'
    });
  }
});

// Get teacher schedule (courses with timings)
app.get('/teacher/:teacherId/schedule', async (req, res) => {
  try {
    const db = await dbPromise;
    const { teacherId } = req.params;
    // Get all courses the teacher is enrolled in
    const courses = await db.all(`
      SELECT c.*, cl.name as class_name FROM courses c
      LEFT JOIN classes cl ON c.class_id = cl.id
      INNER JOIN teacher_enrollments te ON te.course_id = c.id
      WHERE te.teacher_id = ?
    `, [teacherId]);
    // Parse schedule JSON for each course
    const result = courses.map(course => ({
      id: course.id,
      title: course.title,
      class_name: course.class_name,
      schedule: course.schedule ? JSON.parse(course.schedule) : []
    }));
    res.json(result);
  } catch (error) {
    console.error('[Teacher] Error fetching schedule:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch teacher schedule' });
  }
});

