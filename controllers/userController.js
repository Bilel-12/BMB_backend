const asyncHandler = require("express-async-handler");
const generateToken = require("../utils/generateToken.js");
const bcrypt = require("bcryptjs");

const User = require("../Models/userModel.js");
const { default: mongoose } = require("mongoose");
const { sign } = require("jsonwebtoken");
const authUser = asyncHandler(async (req, res) => {
  const { pseudo, password } = req.body;

  const user = await User.findOne({ pseudo });

  if (!user || !(await user.matchPassword(password))) {
    res.status(401);
    throw new Error("خطأ في إسم الحساب أو كلمة السر");
  }



  const previousLastLogin = user.lastLogin;
  user.lastLogin = new Date();
  await user.save();

  // Fonction utilitaire pour récupérer les enfants directs d'une liste de parents
  const getChildren = async (parentIds) => {
    if (!parentIds || parentIds.length === 0) return [];
    return await User.find({ parent: { $in: parentIds } });
  };

  // 1ère génération
  const firstGenUsers = await getChildren([user._id]);
  const firstGenIds = firstGenUsers.map(u => u._id);

  // 2ème génération
  const secondGenUsers = await getChildren(firstGenIds);
  const secondGenIds = secondGenUsers.map(u => u._id);

  // 3ème génération
  const thirdGenUsers = await getChildren(secondGenIds);
  const thirdGenIds = thirdGenUsers.map(u => u._id);

  // 4ème génération
  const fourthGenUsers = await getChildren(thirdGenIds);
  const fourthGenIds = fourthGenUsers.map(u => u._id);

  // 5ème génération
  const fifthGenUsers = await getChildren(fourthGenIds);
  const fifthGenIds = fifthGenUsers.map(u => u._id);


  // Formater les dates de connexion
  const formatDate = (date) =>
    date
      ? date.toLocaleString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })
      : null;

  generateToken(res, user._id);

  res.json({
    _id: user._id,
    nom: user.nom,
    prenom: user.prenom,
    pseudo: user.pseudo,
    cin: user.cin,
    email: user.email,
    tel: user.tel,
    password: user.password,
    // points: user.points,
    allpoints: user.allpoints,
    pointstosend: user.pointstosend,
    role: user.role,
    createdAt: user.createdAt,
    lastLogin: formatDate(user.lastLogin),
    previousLastLogin: formatDate(previousLastLogin),
    // Comptes par génération
    firstGenUserCount: firstGenUsers.length,
    secondGenUserCount: secondGenUsers.length,
    thirdGenUserCount: thirdGenUsers.length,
    fourthGenUserCount: fourthGenUsers.length,
    fifthGenUserCount: fifthGenUsers.length,

  });
});


const registerUser = asyncHandler(async (req, res) => {
  const {
    nom,
    prenom,
    cin,
    email,
    password,
    pseudo,
    tel,
    parentId,
    position
  } = req.body;

  // 1) Vérif utilisateur connecté
  const connectedUser = req.user;
  if (!connectedUser) {
    res.status(401);
    throw new Error("المستخدم غير موجود");
  }

  // Vérif rôle et points
  if (connectedUser.role !== "user") {
    res.status(403);
    throw new Error("فقط المستخدمون يمكنهم إرسال النقاط إلى المشرف.");
  }

  if (connectedUser.pointstosend < 150) {
    res.status(403);
    throw new Error("لا يمكنك إنشاء حساب جديد. يجب أن يكون لديك على الأقل 150 نقطة.");
  }

  // Vérif doublons
  const duplicate = await User.findOne({ $or: [{ email }, { pseudo }, { cin }] });
  if (duplicate) {
    res.status(400);
    throw new Error("المستخدم موجود بالفعل (email أو pseudo أو CIN مستعمل)");
  }

  let parent = null;
  if (parentId) {
    parent = await User.findById(parentId);
    if (!parent) {
      res.status(404);
      throw new Error("الأب غير موجود");
    }
    if (!["left", "right"].includes(position)) {
      res.status(400);
      throw new Error("الموضع غير صالح: استعمل 'left' أو 'right'");
    }
  }

  // 3) Déterminer rôle du nouvel utilisateur
  const isFirstUser = (await User.countDocuments({})) === 0;
  const userRole = isFirstUser ? "admin" : "user";


  // 4) Créer le nouvel utilisateur
  const newUser = await User.create({
    nom,
    prenom,
    cin,
    email,
    password,
    pseudo,
    tel,
    createdBy: connectedUser.pseudo,
    parent: parent ? parent._id : null,
    position: parent ? position : null,
    points: 0,
    allpoints: 0,
    pointstosend: 0,
    role: userRole,
    notifications: [],
    PasswordFack: password
  });

  // 5) Mise à jour des points dès la création
  if (newUser.parent) {
    await updateAncestorsPoints(newUser._id);
  }
  else {
    await updateParentPoints(newUser._id);
  }

  // 6) Transférer 150 points vers l’admin
  const adminUser = await User.findOne({ role: "admin" });
  if (adminUser) {
    connectedUser.pointstosend -= 150;
    adminUser.pointstosend += 150;
    await connectedUser.save();
    await adminUser.save();
  }

  // 7) Réponse
  res.status(201).json({
    _id: newUser._id,
    nom: newUser.nom,
    prenom: newUser.prenom,
    cin: newUser.cin,
    email: newUser.email,
    pseudo: newUser.pseudo,
    tel: newUser.tel,
    parent: newUser.parent,
    position: newUser.position,
    points: newUser.points,
    allpoints: newUser.allpoints,
    pointstosend: newUser.pointstosend,
    role: newUser.role,
  });
});




async function updateParentPoints(parentId) {
  const parent = await User.findById(parentId);
  if (!parent) return;


  async function calculateCounts(userId, generation = 1, maxGen = 5) {

    if (generation > maxGen) return { leftCount: 0, rightCount: 0 };

    const leftChildren = await User.find({ parent: userId, position: "left" }).select("_id");
    const rightChildren = await User.find({ parent: userId, position: "right" }).select("_id");

    let leftCount = 0;
    let rightCount = 0;

    for (const child of leftChildren) {
      if (generation < maxGen) {
        const childRes = await calculateCounts(child._id, generation + 1, maxGen);

        leftCount += 1 + childRes.leftCount + childRes.rightCount;
      } else {
        leftCount += 1;
      }
    }

    for (const child of rightChildren) {
      if (generation < maxGen) {
        const childRes = await calculateCounts(child._id, generation + 1, maxGen);
        rightCount += 1 + childRes.leftCount + childRes.rightCount;
      } else {
        rightCount += 1;
      }
    }

    return { leftCount, rightCount };
  }


  const { leftCount, rightCount } = await calculateCounts(parent._id, 1, 5);


  const points = 90 * Math.min(leftCount, rightCount);


  parent.points = points;
  await parent.save();

  return parent.points;
}

async function updateAncestorsPoints(userId) {

  let current = await User.findById(userId);

  while (current && current.parent) {
    await updateParentPoints(current.parent);
    current = await User.findById(current.parent);
  }
}


// Contrôleur pour tree-stats avec héritage de position
const getTreeStats = async (req, res) => {
  try {
    const { userId } = req.params;
    const maxGenerations = 5; // limite à 5 générations

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const generations = [];
    let currentGenUsers = [{ id: user._id, inheritedSide: null }]; // côté hérité par rapport à A

    for (let gen = 1; gen <= maxGenerations; gen++) {
      let nextGenUsers = [];
      let leftPartners = 0;
      let rightPartners = 0;

      for (const u of currentGenUsers) {
        // récupérer les enfants directs
        const children = await User.find({ parent: u.id }).select("_id position");

        for (const child of children) {
          // déterminer le côté hérité par rapport à A
          let side = child.position;
          if (u.inheritedSide) side = u.inheritedSide; // si parent hérite d'un côté, on transmet

          if (side === "left") leftPartners++;
          if (side === "right") rightPartners++;

          nextGenUsers.push({ id: child._id, inheritedSide: side });
        }
      }

      if (leftPartners + rightPartners > 0) {
        generations.push({
          generation: gen,
          leftPartners,
          rightPartners,
        });
      }

      currentGenUsers = nextGenUsers;
      if (currentGenUsers.length === 0) break;
    }

    res.json({ generations });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};


const updateTotalIncome = asyncHandler(async (req, res) => {
  const { totalIncome } = req.body; // Get the total income from the request body
  const user = await User.findById(req.user._id); // Find the user based on the logged-in user's ID

  if (user) {
    user.points = totalIncome;
    await user.save(); // Save the updated user document

    res.json({
      message: "Total income updated successfully",
      points: user.points,
    });
  } else {
    res.status(404);
    throw new Error("User not found");
  }
});


const getNotifications = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id); // `req.user` is available due to `protect` middleware

  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  res.status(200).json({ notifications: user.notifications });
});

const getSolde = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id); // `req.user` is available due to `protect` middleware
  // somme des soldes des notifications 
  const totalTransfer = user.notifications.reduce((acc, notif) => {
    return acc + (notif.solde * notif.sign);
  }, 0);
  const solde = totalTransfer + user.points;
  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  res.status(200).json({ solde: solde, points: user.points, totalTransfer: totalTransfer });
});






const transferPoints = asyncHandler(async (req, res) => {
  const { senderPseudo, recipientId, pointsToTransfer, pointsToSending, password } = req.body;

  // 🔹 Trouver expéditeur et destinataire
  const sender = await User.findOne({ pseudo: senderPseudo });
  const recipient = await User.findById(recipientId);

  if (!sender || !recipient) {
    return res.status(404).json({ message: "Sender or recipient not found" });
  }

  // 🔹 Vérifier mot de passe
  const isPasswordMatch = await sender.matchPassword(password);
  if (!isPasswordMatch) {
    return res.status(401).json({ message: "Incorrect password" });
  }

  // 🔹 Calcul du solde réel dispo = points + somme des mouvements en notifications
  // const totalTransfer = sender.notifications.reduce((acc, notif) => acc + (notif.solde || 0) * (notif.sign || 1), 0);
  // const soldeDispo = sender.points + totalTransfer;


  const totalTransfer = sender.notifications.reduce((acc, notif) => {
    return acc + (notif.solde * notif.sign);
  }, 0);
  const solde = totalTransfer + sender.points;
  if (solde < pointsToTransfer) {
    return res.status(400).json({ message: "رصيدك غير كافٍ لإتمام العملية!" });
  }

  // 🔹 Déduire des soldes existants (priorité à pointstosend comme avant)
  let remainingToDeduct = pointsToTransfer;

  if (sender.pointstosend >= remainingToDeduct) {
    sender.pointstosend -= remainingToDeduct;
    remainingToDeduct = 0;
  } else {
    remainingToDeduct -= sender.pointstosend;
    sender.pointstosend = 0;
  }

  if (remainingToDeduct > 0) {
    sender.points -= remainingToDeduct;
  }

  // 🔹 Ajouter points au destinataire
  // recipient.points += pointsToTransfer;
  recipient.pointstosend += pointsToSending;

  // 🔹 Ajouter notifications avec solde/sign comme ta 2ᵉ API
  sender.notifications.push({
    message: `لقد أرسلت ${pointsToTransfer} نقطة إلى ${recipient.pseudo || "utilisateur"}.`,
    date: new Date(),
    isRead: false,
    solde: pointsToTransfer,
    sign: -1,
  });

  recipient.notifications.push({
    message: `${senderPseudo} أرسل إليك ${pointsToTransfer} نقطة.`,
    date: new Date(),
    isRead: false,
    solde: pointsToTransfer,
    sign: 1,
  });

  // 🔹 Sauvegarder
  await sender.save();
  await recipient.save();

  res.status(200).json({ message: "✅ Points transferred successfully" });
});



const logoutUser = asyncHandler(async (req, res) => {
  res.cookie("jwt", "", {
    httpOnly: true,
    expires: new Date(0),
  });
  res.status(200).json({ message: "تم تسجيل الخروج بنجاح" });
});

const getUserProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);

  if (user) {
    res.json({
      _id: user._id,
      nom: user.nom,
      email: user.email,

    });
  } else {
    res.status(404);
    throw new Error("لم يتم العثور على المستخدم");
  }
});
const getUserPoints = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);

  if (user) {
    res.json({
      _id: user._id,
      nom: user.nom,
      email: user.email,
      points: user.points,
      allpoints: user.allpoints,
      pointstosend: user.pointstosend,
      prenom: user.prenom,
      rank: user.rank,
      pseudo: user.pseudo,
    });
  } else {
    res.status(404);
    throw new Error("لم يتم العثور على المستخدم");
  }
});

const updateUserProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (user) {

    user.email = req.body.email || user.email;
    user.pseudo = req.body.pseudo || user.pseudo;
    user.tel = req.body.tel || user.tel;
    user.password = req.body.password || user.password;

    if (req.body.password) {
      user.password = req.body.password;
    }

    const updatedUser = await user.save();

    res.json({
      _id: updatedUser._id,

      email: updatedUser.email,
      tel: updatedUser.tel,
      password: updatedUser.password,
      PasswordFack: updatedUser.PasswordFack,

    });
  } else {
    res.status(404);
    throw new Error("لم يتم العثور على المستخدم");
  }
});





module.exports = {
  authUser,
  registerUser,
  logoutUser,
  getUserProfile,
  updateUserProfile,
  updateTotalIncome,
  getNotifications,
  transferPoints,
  getTreeStats,
  getUserPoints,
  getSolde,

};

