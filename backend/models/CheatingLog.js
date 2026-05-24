const mongoose = require('mongoose');
const schema = new mongoose.Schema({ userId:{type:mongoose.Schema.Types.ObjectId,ref:'User'}, userName:{type:String}, userEmail:{type:String}, testId:{type:mongoose.Schema.Types.ObjectId,ref:'Test'}, testTitle:{type:String}, violations:{type:Number,default:0}, autoSubmitted:{type:Boolean,default:false}, details:{type:String} }, { timestamps:true });
module.exports = mongoose.model('CheatingLog', schema);
