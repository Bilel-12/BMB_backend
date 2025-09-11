const asyncHandler = require("express-async-handler");
const generateToken = require("../utils/generateToken.js");
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

  // recalcul des points pour cet utilisateur
  // if (user.parent) {
  //   await updateParentPoints(user.parent);
  // } else {
  //   await updateParentPoints(user._id); // si c’est la racine
  // }

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

  // 6ème génération
  const sixthGenUsers = await getChildren(fifthGenIds);

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
    sixthGenUserCount: sixthGenUsers.length,
  });
});


// controllers/tonController.js (remplace seulement registerUser)

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
    points: 45,
    allpoints: 0,
    pointstosend: 0,
    role: userRole,
    notifications: [],
    PasswordFack: password
  });

  // 5) Mise à jour des points dès la création
  if (newUser.parent) {
    await updateAncestorsPoints(newUser._id); // recalcul toute la lignée ascendante
  } else {
    await updateParentPoints(newUser._id); // si c’est la racine
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

async function updateAncestorsPoints(userId) {
  let current = await User.findById(userId);

  while (current && current.parent) {
    await updateParentPoints(current.parent);
    current = await User.findById(current.parent);
  }
}


// Fonction récursive pour calculer les points et descendants

async function updateParentPoints(parentId) {
  const parent = await User.findById(parentId);
  if (!parent) return;

  async function calculateBalancedPoints(userId) {
    // Récupérer tous les enfants directs
    const leftChildren = await User.find({ parent: userId, position: "left" }).select("_id");
    const rightChildren = await User.find({ parent: userId, position: "right" }).select("_id");

    let leftCount = 0;
    let rightCount = 0;

    // Compter récursivement les descendants à gauche
    for (const child of leftChildren) {
      const childResult = await calculateBalancedPoints(child._id);
      leftCount += 1 + childResult.leftCount + childResult.rightCount; // 1 = l'enfant lui-même
    }

    // Compter récursivement les descendants à droite
    for (const child of rightChildren) {
      const childResult = await calculateBalancedPoints(child._id);
      rightCount += 1 + childResult.leftCount + childResult.rightCount;
    }

    // Points équilibrés = 90 * min(nombre total gauche, nombre total droite)
    const points = 90 * Math.min(leftCount, rightCount);

    // Sauvegarder l'utilisateur avec ses points
    const user = await User.findById(userId);
    user.points = points;
    await user.save();

    return { leftCount, rightCount }; // ne retourne pas de totalPoints
  }

  await calculateBalancedPoints(parent._id);

  return parent.points;
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
  const { senderPseudo, recipientId, pointsToTransfer, password } = req.body;

  const sender = await User.findOne({ pseudo: senderPseudo });
  if (!sender) return res.status(404).json({ message: "Sender not found" });

  const isPasswordMatch = await sender.matchPassword(password);
  if (!isPasswordMatch) return res.status(401).json({ message: "Incorrect password" });

  // Vérifier solde réel disponible (points + transferts déjà reçus)
  const totalTransfer = sender.notifications.reduce((acc, notif) => acc + notif.solde * notif.sign, 0);
  const soldeDispo = sender.points + totalTransfer;
  if (soldeDispo < pointsToTransfer) {
    return res.status(400).json({ message: "رصيدك غير كافٍ لإتمام العملية!" });
  }

  // Ajouter notification au sender (débit)
  sender.notifications.push({
    message: `لقد أرسلت ${pointsToTransfer} نقطة.`,
    date: new Date(),
    isRead: false,
    solde: pointsToTransfer,
    sign: -1,
  });
  await sender.save();

  // Ajouter notification au recipient (crédit)
  const recipient = await User.findById(recipientId);
  if (!recipient) return res.status(404).json({ message: "Recipient not found" });

  recipient.notifications.push({
    message: `${senderPseudo} أرسل إليك ${pointsToTransfer} نقطة.`,
    date: new Date(),
    isRead: false,
    solde: pointsToTransfer,
    sign: 1,
  });
  await recipient.save();

  res.status(200).json({ message: "✅ Points transferred successfully" });
});






// const transferPoints = asyncHandler(async (req, res) => {
//   const {
//     senderPseudo,
//     recipientId,
//     pointsToTransfer,
//     pointsToSending,
//     password,
//   } = req.body;

//   // 1️⃣ Conversion des points en nombres
//   const ptsTransfer = Number(pointsToTransfer);
//   const ptsSending = Number(pointsToSending);

//   if (isNaN(ptsTransfer) || isNaN(ptsSending) || ptsTransfer <= 0) {
//     return res.status(400).json({ message: "Points invalides" });
//   }

//   // 2️⃣ Trouver l’expéditeur et le destinataire
//   const sender = await User.findOne({ pseudo: senderPseudo });
//   const recipient = await User.findById(recipientId);

//   if (!sender || !recipient) {
//     return res.status(404).json({ message: "Expéditeur ou destinataire introuvable" });
//   }

//   // 3️⃣ Vérifier le mot de passe
//   const isPasswordMatch = await sender.matchPassword(password);
//   if (!isPasswordMatch) {
//     return res.status(401).json({ message: "Mot de passe incorrect" });
//   }

//   // 4️⃣ Vérifier le solde disponible
//   if (sender.points < ptsTransfer) {
//     return res.status(400).json({ message: "رصيدك غير كافٍ لإتمام العملية!" });
//   }

//   // 5️⃣ Démarrer une transaction MongoDB
//   const session = await mongoose.startSession();
//   session.startTransaction();

//   try {
//     // Déduire les points de l’expéditeur
//     sender.points -= ptsTransfer;

//     // Ajouter les points au destinataire
//     recipient.points += ptsTransfer;
//     recipient.pointstosend += ptsSending;

//     // Notifications
//     recipient.notifications.push({
//       message: `${senderPseudo} أرسل إليك ${ptsTransfer} نقطة.`,
//       date: new Date(),
//       isRead: false,
//     });

//     sender.notifications.push({
//       message: `لقد أرسلت ${ptsTransfer} نقطة إلى ${recipient.pseudo || "a user"}.`,
//       date: new Date(),
//       isRead: false,
//     });

//     // Sauvegarder expéditeur et destinataire dans la transaction
//     await sender.save({ session });
//     await recipient.save({ session });

//     // Mettre à jour les points du parent de l’expéditeur
//     if (sender.parent) {
//       await updateParentPoints(sender.parent);
//     }

//     // Commit transaction
//     await session.commitTransaction();
//     session.endSession();

//     res.status(200).json({ message: "Points transférés avec succès" });
//   } catch (error) {
//     // En cas d’erreur, rollback
//     await session.abortTransaction();
//     session.endSession();
//     res.status(500).json({ message: "Erreur lors du transfert", error: error.message });
//   }
// });


// const transferPoints = asyncHandler(async (req, res) => {
//   const {
//     senderPseudo,
//     recipientId,
//     pointsToTransfer,
//     pointsToSending,
//     password,
//   } = req.body;

//   // 1️⃣ Trouver l’expéditeur et le destinataire
//   const sender = await User.findOne({ pseudo: senderPseudo });
//   const recipient = await User.findById(recipientId);

//   if (!sender || !recipient) {
//     return res.status(404).json({ message: "Sender or recipient not found" });
//   }

//   // 2️⃣ Vérifier le mot de passe
//   const isPasswordMatch = await sender.matchPassword(password);
//   if (!isPasswordMatch) {
//     return res.status(401).json({ message: "Incorrect password" });
//   }

//   // 3️⃣ Vérifier le solde disponible (seulement points)
//   if (sender.points < pointsToTransfer) {
//     return res.status(400).json({ message: "رصيدك غير كافٍ لإتمام العملية!" });
//   }

//   // 4️⃣ Déduire les points de l’expéditeur
//   sender.points -= pointsToTransfer;

//   // 5️⃣ Ajouter les points au destinataire
//   recipient.points += pointsToTransfer;
//   recipient.pointstosend += pointsToSending;

//   // 6️⃣ Ajouter notifications
//   recipient.notifications.push({
//     message: `${senderPseudo} أرسل إليك ${pointsToTransfer} نقطة.`,
//     date: new Date(),
//     isRead: false,
//   });

//   sender.notifications.push({
//     message: `لقد أرسلت ${pointsToTransfer} نقطة إلى ${recipient.pseudo || "a user"}.`,
//     date: new Date(),
//     isRead: false,
//   });

//   // 7️⃣ Sauvegarder les changements
//   await sender.save();
//   await recipient.save();

//   // 8️⃣ Mettre à jour les points du parent de l’expéditeur
//   if (sender.parent) {
//     await updateParentPoints(sender.parent);
//   }

//   res.status(200).json({ message: "Points transferred successfully" });
// });




// const transferPoints = async (req, res) => {
//   try {
//     const {
//       senderPseudo,
//       recipientId,
//       pointsToTransfer,
//       pointsToSending,
//       password,
//     } = req.body;

//     // Find sender and recipient
//     const sender = await User.findOne({ pseudo: senderPseudo });
//     const recipient = await User.findById(recipientId);

//     if (!sender || !recipient) {
//       return res.status(404).json({ message: "Sender or recipient not found" });
//     }

//     // Verify password
//     const isPasswordMatch = await sender.matchPassword(password);
//     if (!isPasswordMatch) {
//       return res.status(401).json({ message: "Incorrect password" });
//     }

//     // Check total available balance (sum of points + pointstosend)
//     const totalAvailable = sender.points ;
//     console.log(totalAvailable, 'totalAvailabletotalAvailabletotalAvailable');

//     if (totalAvailable < pointsToTransfer) {
//       return res
//         .status(400)
//         .json({ message: "رصيدك غير كافٍ لإتمام العملية!" });
//     }

//     // Deduct from pointstosend first, then from points if needed
//     let remainingToDeduct = pointsToTransfer;

//     if (sender.pointstosend >= remainingToDeduct) {
//       sender.pointstosend -= remainingToDeduct;
//       remainingToDeduct = 0;
//     } else {
//       remainingToDeduct -= sender.pointstosend;
//       sender.pointstosend = 0;
//     }

//     if (remainingToDeduct > 0) {
//       sender.points -= remainingToDeduct;
//     }

//     // Add points to the recipient
//     recipient.points += pointsToTransfer;
//     recipient.pointstosend += pointsToSending;

//     // Add notifications
//     recipient.notifications.push({
//       message: `${senderPseudo} أرسل إليك ${pointsToTransfer} نقطة.`,
//       date: new Date(),
//       isRead: false,
//     });

//     sender.notifications.push({
//       message: `لقد أرسلت ${pointsToTransfer} نقطة إلى ${recipient.pseudo || "a user"
//         }.`,
//       date: new Date(),
//       isRead: false,
//     });

//     // Save both users
//     await sender.save();
//     await recipient.save();

//     // Respond with success
//     res.status(200).json({ message: "Points transferred successfully" });
//   } catch (error) {
//     console.error("Error transferring points:", error);
//     res.status(500).json({ message: "Error transferring points" });
//   }
// };

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
// const updateUserProfile = asyncHandler(async (req, res) => {
//   const user = await User.findById(req.user._id);
//   if (user) {
//     user.nom = req.body.nom || user.nom;
//     user.prenom = req.body.prenom || user.prenom;
//     user.email = req.body.email || user.email;
//     user.pseudo = req.body.pseudo || user.pseudo;
//     user.tel = req.body.tel || user.tel;
//     user.parent = req.body.parent || user.parent;
//     user.leftChild = req.body.leftChild || user.leftChild;
//     user.rightChild = req.body.rightChild || user.rightChild;
//     user.position = req.body.position || user.position;
//     user.password = req.body.password || user.password;

//     if (req.body.password) {
//       user.password = req.body.password;
//     }

//     const updatedUser = await user.save();

//     res.json({
//       _id: updatedUser._id,
//       nom: updatedUser.nom,
//       prenom: updatedUser.prenom,
//       email: updatedUser.email,
//       tel: updatedUser.tel,
//       password: updatedUser.password,
//     });
//   } else {
//     res.status(404);
//     throw new Error("لم يتم العثور على المستخدم");
//   }
// });
const updateUserProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (user) {
    user.nom = req.body.nom || user.nom;
    user.prenom = req.body.prenom || user.prenom;
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
      nom: updatedUser.nom,
      prenom: updatedUser.prenom,
      email: updatedUser.email,
      tel: updatedUser.tel,
      password: updatedUser.password,
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
  getSolde
};

