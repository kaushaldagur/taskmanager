const mongoose = require("mongoose");

const taskSchema = new mongoose.Schema({
  title: String,
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  status: { type: String, default: "todo" },
  deadline: Date,
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
});

module.exports = mongoose.model("Task", taskSchema);