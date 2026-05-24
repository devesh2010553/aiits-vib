const mongoose = require('mongoose');
const adImageSchema = new mongoose.Schema({ title:{type:String,default:''}, description:{type:String,default:''}, imageData:{type:String,required:true}, redirectUrl:{type:String,default:''}, showOnHome:{type:Boolean,default:true} }, { timestamps:true });
module.exports = mongoose.model('AdImage', adImageSchema);
