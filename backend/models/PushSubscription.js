const mongoose = require('mongoose');
const schema = new mongoose.Schema({ userId:{type:mongoose.Schema.Types.ObjectId,ref:'User'}, endpoint:{type:String,required:true,unique:true}, keys:{p256dh:String,auth:String} }, { timestamps:true });
module.exports = mongoose.model('PushSubscription', schema);
