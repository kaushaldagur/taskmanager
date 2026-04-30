# 🚀 Task Manager (MERN Stack)

A full-stack Task Management Web Application where users can create projects, assign tasks, and track progress with role-based access control.

---

## 🌐 Live Demo

🔗 Frontend: https://your-vercel-link.vercel.app
🔗 Backend (Railway): https://your-app.up.railway.app

---

## 📦 GitHub Repository

https://github.com/kaushaldagur/taskmanager

---

## ✨ Features

### 🔐 Authentication

* User Signup & Login
* JWT-based authentication

### 👨‍💼 Role-Based Access

* Admin:

  * Create projects
  * Assign tasks
  * View all data
* Member:

  * View assigned tasks
  * Update task status

### 📂 Project Management

* Create projects
* Assign members
* View project-wise tasks

### 📝 Task Management

* Create tasks under projects
* Assign tasks to users
* Update status (Pending / Done)
* Overdue tracking

### 📊 Dashboard

* Total tasks
* Completed tasks
* Pending tasks
* Overdue tasks

---

## 🛠 Tech Stack

### Frontend

* React.js
* Axios
* CSS

### Backend

* Node.js
* Express.js
* MongoDB (Mongoose)

### Deployment

* Backend: Railway
* Frontend: Vercel

---

## ⚙️ Installation (Local Setup)

### 1. Clone repo

```bash
git clone https://github.com/kaushaldagur/taskmanager.git
cd taskmanager
```

---

### 2. Backend Setup

```bash
cd backend
npm install
```

Create `.env`:

```env
MONGO_URI=your_mongodb_uri
JWT_SECRET=your_secret
```

Run:

```bash
node server.js
```

---

### 3. Frontend Setup

```bash
cd frontend
npm install
npm start
```

---

## 🔐 Environment Variables

### Backend (.env)

* MONGO_URI
* JWT_SECRET

---

## 📌 API Endpoints

### Auth

* POST /signup
* POST /login

### Projects

* POST /projects
* GET /projects

### Tasks

* POST /tasks
* GET /tasks
* PUT /tasks/:id

### Dashboard

* GET /dashboard

---

## 🎯 Assignment Requirements Covered

✔ REST APIs + MongoDB
✔ Role-based access (Admin / Member)
✔ Project & Task management
✔ Dashboard with stats
✔ Deployment on Railway

---

## 🙌 Author

**Kaushal Dagur**

---

## ⭐ Notes

* First request may be slow (free hosting)
* Ensure MongoDB Atlas allows access (0.0.0.0/0)

---
