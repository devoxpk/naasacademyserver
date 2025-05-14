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
  allowedHeaders: ['Content-Type', 'Authorization'],
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

    // Check if user is approved
    if (user.status !== 'approved') {
      console.log(`[Login] Failed login attempt for email ${email}: Account pending approval`);
      return res.status(403).json({
        success: false,
        message: 'Your account is pending approval'
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
      registration_id TEXT UNIQUE,
      name TEXT NOT NULL,
      email TEXT UNIQUE,
      phone TEXT,
      password TEXT NOT NULL,
      role TEXT NOT NULL,
      student_name TEXT,
      student_grade TEXT,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
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

    res.json(parsedCourses);
  } catch (error) {
    console.error('Error fetching courses:', error);
    res.status(500).json({ error: 'Failed to fetch courses' });
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

    // Validate required fields
    if (!name || !email || !password || !role || !registrationId) {
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
    if (existingUser) {
      console.log(`Registration attempt with existing email: ${email}`);
      return res.status(409).json({
        success: false,
        message: 'This email is already registered'
      });
    }

    await db.run(
      `INSERT INTO users (registration_id, name, email, phone, password, role, student_name, student_grade, gender, documents, selected_class)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [registrationId, name, email, phone, password, role, studentName, studentGrade, gender, documents, selectedClass]
    );

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
});

// Get pending registrations
app.get('/registrations/pending', async (req, res) => {
  try {
    const db = await dbPromise;
    const rows = await db.all('SELECT * FROM users WHERE status = ?', ['pending']);
    res.json(rows);
  } catch (error) {
    console.error('[Registration] Error fetching pending registrations:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pending registrations'
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
  try {
    const { id } = req.params;
    const { status } = req.body;
    const db = await dbPromise;

    // Get user details
    const user = await db.get('SELECT * FROM users WHERE registration_id = ?', [id]);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    await db.run('UPDATE users SET status = ? WHERE registration_id = ?', [status, id]);

    // If approved and student role, enroll in selected class
    if (status === 'approved' && user.role === 'student' && user.selected_class) {
      await db.run(
        'INSERT INTO student_enrollments (student_id, course_id, status) VALUES (?, ?, ?)',
        [user.id, user.selected_class, 'approved']
      );
    }

    res.json({ success: true });
  } catch (error) {
    console.error('[Registration] Error updating status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update registration status'
    });
  }
});

// Delete registration
app.delete('/registrations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const db = await dbPromise;
    
    // Check if registration exists
    const registration = await db.get('SELECT * FROM users WHERE registration_id = ?', [id]);
    if (!registration) {
      return res.status(404).json({
        success: false,
        message: 'Registration not found'
      });
    }
    
    await db.run('DELETE FROM users WHERE registration_id = ?', [id]);
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

