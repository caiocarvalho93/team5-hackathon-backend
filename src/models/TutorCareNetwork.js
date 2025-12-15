const mongoose = require("mongoose");

const TutorCareNetworkSchema = new mongoose.Schema(
  {
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true, index: true },
    tutorIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "User", index: true }],
    lastInteractionAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Indexes already defined in schema with index: true

// Static method to link a tutor to a student's care network
TutorCareNetworkSchema.statics.linkTutorToStudent = async function(studentId, tutorId) {
  return this.findOneAndUpdate(
    { studentId },
    { 
      $addToSet: { tutorIds: tutorId },
      $set: { lastInteractionAt: new Date() }
    },
    { upsert: true, new: true }
  );
};

module.exports = mongoose.model("TutorCareNetwork", TutorCareNetworkSchema);
