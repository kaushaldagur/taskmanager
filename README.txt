Team Task Manager

Overview
Team Task Manager is a full-stack role-based project and task tracking app.
Admins can create projects, assign tasks to members, and track global progress.
Members can view projects they are assigned to, see all tasks inside those projects, complete their own tasks, and track personal progress.

Tech Stack
Frontend: React
Backend: Node.js, Express
Database: MongoDB with Mongoose
Authentication: JWT

Key Features
1. Authentication
- Signup and login with email/password.
- JWT-protected REST APIs.

2. Role-Based Access
- Admins can create projects and assign tasks.
- Members can view their assigned projects and personal task dashboard.
- Members can view all tasks inside a project where they have at least one assigned task.
- Members can only mark their own assigned tasks as complete.

3. Project Management
- Admins can create projects.
- Project cards show total tasks and actual completion progress.
- Project detail pages show task assignment and status.

4. Task Management
- Admins can create tasks and assign them to users by email.
- Tasks belong to projects and users.
- Tasks support pending/done status.

5. Dashboard
- Admin stats show total tasks, completed, pending, and overdue.
- Member stats show their own total, completed, and pending tasks.

Local Setup
1. Install dependencies:
   cd backend
   npm install

   cd ../frontend
   npm install

2. Create backend/.env:
   MONGO_URI=your_mongodb_connection_string
   JWT_SECRET=your_secret_key

3. Start backend:
   cd backend
   node server.js

4. Start frontend:
   cd frontend
   npm start

Local URLs
Frontend: http://localhost:3000
Backend: http://localhost:5000

REST API Summary
POST /signup - Create user account
POST /login - Login and receive JWT
GET /projects - Get visible projects by role
POST /projects - Admin creates project
GET /projects/:id/tasks - Get all tasks for a visible project
GET /tasks - Get admin all tasks or member assigned tasks
POST /tasks - Admin creates assigned task
PUT /tasks/:id - Mark task complete
GET /dashboard - Get role-based dashboard stats

Deployment Notes
Deploy backend and frontend using Railway.
Set MONGO_URI and JWT_SECRET as Railway environment variables.
Update the frontend API base URL from localhost to the deployed backend URL before final production deployment.

Submission Checklist
- Live Application URL
- GitHub Repository Link
- README.txt
- 2-5 minute demo video explaining login, admin flow, member flow, project progress, and task status tracking
